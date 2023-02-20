'use strict';
/**
 * IBM Cloud Functions base api implementation.
 */
/* eslint-disable prefer-promise-reject-errors */
/* eslint-disable no-throw-literal */
// dependencies
console.log('initializing first api run');
const path = require('path');
const qs = require('qs');
const fs = require('fs');
console.log('loading session utils');
const session = require('../utils/util-session');
console.log('loading permission middleware');
const permMiddleware = require('../utils/util-permission-middleware');
console.log('loading encryption mechanisms');
const encryption = require('../utils/util-encryption');
console.log('loading key utils');
const key = require('../utils/util-keys.js');
console.log('loading audit logger');
const auditLogging = require('../utils/util-auditlogging');
const callFunction = require('../utils/util-callFunction');
let warmed = false;
// dotenv environment variables. NEVER COMMIT A .ENV FILE !!!
require('dotenv').config('../.env');

const generic = require('../routers/generic.js');

let myKey;

// first time generate a key to help track reusability of functions
if (!myKey) {
  myKey = key.generate();
}

function arrangeRequest(args) {
  return new Promise((resolve, reject) => {
    const req = {
      method: args.__ow_method,
      headers: args.__ow_headers,
      params: args.__ow_path.replace(/^\//, '').split('/'),
      query: qs.parse(args.__ow_query),
      originip: args.__ow_headers['cf-connecting-ip'] || args.__ow_headers['x-real-ip'] || null
    };

    try {
      req.body = JSON.parse(args.__ow_body && typeof args.__ow_body === 'string' ? Buffer.from(args.__ow_body, 'base64').toString() : '{}');
    } catch (ex) {
      return reject({ status: 505, message: 'Error wh ile parsing json: ' + JSON.stringify(ex) });
    }
    console.log({ method: req.method, params: req.params, query: req.query, token: req.headers['x-access-token'], ip: req.headers['x-real-ip'] });
    resolve(req);
  });
}

// Standerdize the response with the right status and content based on content type
function response(statusCode, body, contentType, compression) {
  const headers = {
    'Content-Type': contentType || 'application/json'
  };
  if (compression) {
    headers['x-compress-brotli'] = true;
    headers['Access-Control-Expose-Headers'] = ['Content-Type', 'Content-length', 'x-compress-brotli'];
  }
  try {
    body = contentType ? body : Buffer.from(typeof body === 'object' ? JSON.stringify(body) : body).toString('base64');
  } catch (e) {
    console.error('error at response', e);
    console.error('error at response body', body);
    throw (e);
  }
  return {
    statusCode: statusCode,
    headers: headers,
    body: body || null
  };
}

// Gets the necessary route or generic route
function getRoute(component, id) {
  try {
    const fileName = path.join(__dirname, '../routers', component + (id ? '-id.js' : '.js'));
    if (fs.existsSync(fileName)) {
      return require(fileName);
    } else {
      return generic;
    }
  } catch (ex) {
    throw {
      status: 500,
      message: 'Error while retrieving router: ' + ex
    };
  }
}

// Calls the route, decrypt and encrypt and handle response
function callRouteMethod(route, method, request) {
  return new Promise((resolve, reject) => {
    try {
      route[method](request, async ret => {
        console.log('start ret');
        // add a activationKey to track reusability measurements
        if (ret.result && ret.result.meta) {
          ret.result.meta.activationKey = myKey;
        }

        console.log('check for patch of users');
        // If there is a change to a user, the active user tocken must be updated
        if (ret.status === 200 && method === 'patch' && ret.result.data.type === 'users') {
          await session.updateUserToken(ret.result.data);
        }
        // Remove password from response
        console.log('check for password');
        if (ret.status === 200 && ret.result.data && ret.result.data.length && ret.result.data[0].type === 'users') {
          ret.result.data.forEach(d => {
            if (d.attributes.password) {
              delete d.attributes.password;
            }
          });
        }

        console.log('check for status');
        if (ret.status > 399) {
          console.error(ret.result);
        }
        if (ret.status === 200 && ret.result.data && request.decoded) {
          if (request.decoded.roles.includes('developer') || request.decoded.roles.includes('auditor')) {
            permMiddleware.filterResponse(request.decoded, ret.result);
          }
        }
        console.log('audit logging');
        auditLogging.log(request, ret);
        console.log('sesstest', 'token:', request.headers['x-access-token'],
          'status:', ret.status,
          'rf:', request.decoded && request.decoded.rf ? request.decoded.rf : null,
          'time:', new Date().getTime(),
          'expiry:', request.decoded && request.decoded.rf ? (request.decoded.rf - new Date().getTime()) / 1000 : null);
        if (ret.status === 200 && request.decoded && (!request.decoded.rf || request.decoded.rf < new Date().getTime())) {
          console.log('refreshing session');
          if (typeof ret.result === 'object') {
            const newCreds = await session.refreshSession(request);
            if (ret.result && ret.result.meta) {
              ret.result.meta.key = newCreds.key;
              ret.result.meta.token = newCreds.token;
            } else if (ret.result && !ret.result.meta) {
              ret.result.meta = {
                key: newCreds.key,
                token: newCreds.token
              };
            }
          }
        }
        console.log('encrypting response');
        if (ret.status > 399) {
          console.log('rejecting as bad status ' + ret.status);
          console.error(ret.result);
        }
        encryption.encriptResponse(ret.result, request).then(data => {
          console.log('done encrypting');
          ret.result = data;
          console.log('checking for bad status', ret.status);
          // if status is not 2xx then reject as it represents a error
          if (ret.status > 399) {
            return reject(ret);
          }
          return resolve(ret);
        }).catch(e => {
          console.error(e);
          return reject({ status: 500, result: { error: e.message } });
        });
      });
    } catch (ex) {
      console.error('error at callRouteMethod try catch');
      return reject(ex);
    }
  });
}

// Main function. Validates permissions and authorization then calls the route and returns response.
const api = async function(args) {
  console.log(`API - toWarm:${!!args.warmup} isWarm:${warmed}`);
  if (args.warmup) {
    if (!warmed) {
      await generic.getOrm();
      warmed = true;
    } else {
      //make sure we actually create a warm one at a maximum of 3 attempts
      if (args.warmcount < args.warmmax) {
        await callFunction('api', { warmup: true, warmcount: args.warmcount + 1, warmmax: args.warmmax }, false, true);
      }
    }
    return { result: { warm: true } };
  } else {
    callFunction('api', { warmup: true, warmcount: 0, warmmax: 0 }, false, true);
    if (!warmed) {
      warmed = true;
    }
  };

  // This is our activation id
  console.log('Activation Request', process.env.__OW_ACTIVATION_ID, 'Instance Key', myKey);
  // at first run, initialize a global orm link to database (reused on susequent calls);
  // arrange our requests in a way we can process them
  // eslint-disable-next-line prefer-const
  let req = await arrangeRequest(args);
  req.orm = generic;
  console.log('Ip Address', req.originip);
  if (req.params[0] && req.params[0] === 'activations') {
    return response(200, process.env.__OW_ACTIVATION_ID);
  }
  try {
    // validates permissions
    const startTime = +new Date();
    await permMiddleware.validate(req);
    const endTime = +new Date();
    console.log('validating permissions took', endTime - startTime, 'ms');
    // gets method, component, id and route to call
    const method = req.method.toLowerCase();
    const component = req.params[0] ? req.params[0] : null;
    const id = req.params[1] ? req.params[1] : null;
    if (id && id === 'null') {
      // wtf?!? who is seinding this shit
      throw { status: 404, message: 'null is not a valid id' };
    }
    const query = req.query;
    console.log({ query });
    console.log({ id });
    if (id) {
      if (req.query.id && Array.isArray(req.query.id)) {
        // So here we are querying something like /api/companies/3 , but lets say
        // that the user does not have permission to see the company 3.
        // The result of the permission middleware is the injection of the query
        // of all avaialble items , lets say the query becsomes [1,4,5]
        // So we need to check if the query we want is included in our array.
        // Additionally , if we are doing a call on a specific id, the id query should be removed
        if (!req.query.id.includes(parseInt(id)) && !req.query.id.includes('' + id)) {
          throw {
            status: 404,
            message: 'Not Found'
          };
        }
        delete req.query.id;
      }
    }
    const route = getRoute(component, id);

    if (!component) {
      throw ('Invalid or No component');
    }

    // Options should return immediatly
    if (method === 'options') {
      return response(200, { result: 'Ok' });
    }

    // Logs our request
    console.log({ method: req.method, query: req.query, component: req.params[0] });
    // calls the router and gets the response
    const ret = await callRouteMethod(route, method, req);
    // cleanup
    if (global.gc) {
      global.gc(); // cleanup
    }
    // standerdize response
    const dataResponse = response(ret.status, ret.result, ret.contentType || null, !!req.headers['x-compress-brotli']);
    // return
    return dataResponse;
  } catch (ex) {
    // some error caught
    console.error('Error occured: ', ex);
    // standerdize error response
    let throwback;
    try {
      const error = ex.result ? ex.result.error || ex.result : ex.error || ex;
      throwback = response(ex.status || 500, { error: error }, null, !!req.headers['x-compress-brotli']);
    } catch (e) {
      console.error(e);
      throwback = {
        statusCode: 500,
        body: { error: e ? e.toString() : 'unspecified error' }
      };
    }
    if (global.gc) {
      global.gc(); // cleanup
    }
    // throwing error
    throw throwback;
  }
};

module.exports = api;
module.exports.config = {
  memory: 1024,
  timeout: 50000, // 300000,
  logsize: 10,
  docker: 'cognus/bluedarwin_node18_v01_min'
};