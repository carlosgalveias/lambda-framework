'use strict';

console.log('@util-permissions-middleware->', 'loading authCtrl');
const authCtrl = require('../utils/util-auth');
console.log('@util-permissions-middleware->', 'loading encryption');
const encryption = require('../utils/util-encryption');
console.log('@util-permissions-middleware->', 'loading generic');
let db; //  = require('../routers/generic');
console.log('@util-permissions-middleware->', 'loading permissions config');
const permissions = require('../config/permissions');
console.log('@util-permissions-middleware->', 'Setting unauthenticatedRoutes');
const unauthenticatedRoutes = permissions.unauthenticatedRoutes;
console.log('@util-permissions-middleware->', 'Done initialize');

let orm;

const filterRelationship = function(decoded, data) {
  const relationships = data.relationships;
  if (!relationships) {
    return;
  }
  for (const key in data.relationships) {
    if (key === 'roles') { // Roles in our decoded is a array with names, not ids, this messes stuff so ignore it
      continue;
    }
    let keydata = data.relationships[key].data;
    if (keydata && Array.isArray(keydata)) {
      if (!keydata || !keydata[0].type || !decoded[keydata[0].type]) {
        continue;
      } else if (keydata[0].type && decoded[keydata[0].type]) {
        const newData = [];
        for (const d of decoded[keydata[0].type]) {
          newData.push({ type: keydata[0].type, id: d });
        }
        data.relationships[key].data = newData;
      }
    } else if (keydata && !Array.isArray(keydata)) {
      if (keydata.type && decoded[keydata.type]) {
        if (!decoded[keydata.type].includes(keydata.id)) {
          keydata = {};
        }
      }
    }
  }
};

const filterRelationships = function(decoded, data) {
  if (Array.isArray(data)) {
    if (!data.length) {
      return;
    }
    for (const item of data) {
      filterRelationship(decoded, item);
    }
  } else {
    filterRelationship(decoded, data);
  }
};

const filterSensitiveData = function(decodedRequest, resultData) {
  // TODO_RP: check if that can be more than one role
  const requestRole = decodedRequest.roles[0];

  // in cases that the access is done directly by id, the result is not an array.
  // to simplify code, we put the single element in the array
  let resultDataArray = [];
  if (!resultData.length) {
    resultDataArray = [resultData];
  } else {
    resultDataArray = resultData;
  }

  const accessRights = permissions.permissionTable.getAccessRights(resultDataArray[0].type, requestRole);
  const hasAccessToSensitiveData = accessRights.includes('read_sensitive');

  // not the most elegant solution, but if there is more sensitive data in the future, 
  // implement marking sensitive data in db\<model>
  for (let dataItem of resultDataArray) {
    if (dataItem.type === 'credentials' && !hasAccessToSensitiveData) {
      delete dataItem.attributes.credentials;
    }
  }
};

const filterResponse = function(decoded, response) {
  const data = response.data;
  filterRelationships(decoded, data);
  filterSensitiveData(decoded, data);
};
const adaptRequestWhenRead = async function(request, params) {
  try {
    db = db || request.orm || require('../routers/generic.js');
    orm = orm || await db.getOrm();
  } catch (e) {
    console.error('util-permissions-middleware->failure to initialize database');
    throw (e);
  }
  const trydecoded = request.decoded;
  // make sure company and projects are integers
  trydecoded.companies = trydecoded.companies ? trydecoded.companies.filter(c => c).map(c => parseInt(c)) : trydecoded.companies;
  trydecoded.projects = trydecoded.projects ? trydecoded.projects.filter(c => c).map(c => parseInt(c)) : trydecoded.projects;

  let modelConstraint = null;
  const attributes = Object.keys(orm.waterline.collections[params.model].attributes);
  if (attributes.includes(params.constraint[0])) {
    modelConstraint = params.constraint[0];
  } else if (attributes.includes(params.constraint[1])) {
    modelConstraint = params.constraint[1];
  } else {
    throw 'Internal Error: "' + params.model + '" has no attribute "' + params.constraint[0] + '" nor "' + params.constraint[1] + '"';
  }
  console.log('modelConstraint', modelConstraint, 'role', trydecoded.roles[0]);
  console.log('before constraint', request.query);
  if (!Object.keys(request.query).includes(modelConstraint)) {
    console.log('#1');
    request.query[modelConstraint] = trydecoded[params.constraint[0]];
  } else {
    if (Array.isArray(request.query[modelConstraint])) {
      request.query[modelConstraint] = request.query[modelConstraint].filter(item => {
        return trydecoded[params.constraint[0]].includes(parseInt(item));
      });

      if (request.query[modelConstraint].length === 0) {
        request.query[modelConstraint] = trydecoded[params.constraint[0]];
      }
    } else {
      if (!trydecoded[params.constraint[0]].includes(parseInt(request.query[modelConstraint]))) {
        request.query[modelConstraint] = trydecoded[params.constraint[0]];
      }
    }
  }

  if (params.model === 'users') {
    if (trydecoded.roles[0] !== 'sysadmin' || trydecoded.roles[0] !== 'sysdeveloper' && trydecoded.roles[0] !== 'sysauditor') {
      request.query.roles = [4, 5, 6, 7];
    }
  }
  console.log('after constraint', request.query);
};
/**
 *
 * @param {Object} request request
 * @param {Object} params parameters
 */
const checkForWritePermissions = async function(request, params) {
  db = db || request.orm || require('../routers/generic.js');
  orm = orm || await db.getOrm();
  const id = request.body && request.body.data ? request.body.data.id : request.params[1] ? parseInt(request.params[1]) : null;
  if (!id) {
    return;
  }

  const attributes = Object.keys(orm.waterline.collections[params.model].attributes);
  let modelConstraint = null;

  if (attributes.includes(params.constraint[0])) {
    modelConstraint = params.constraint[0];
  } else if (attributes.includes(params.constraint[1])) {
    modelConstraint = params.constraint[1];
  } else {
    throw 'Internal Error: "' + params.model + '" has no attribute "' + params.constraint[0] + '" nor "' + params.constraint[1] + '"';
  }

  // the id comes either from data (POST, PATCH) or from the params[1] for DELETE that doesn't come with a body
  const query = {
    params: {
      0: params.model,
      id: id
    },
    query: {}
  };

  query.query[modelConstraint] = request.decoded[params.constraint[0]];
  console.log({ query: JSON.stringify(query) });
  const myGet = function(query) {
    return new Promise((resolve, reject) => {
      db.get(query, ret => {
        if (ret.status === 404) {
          return reject('Insuficient Permissions');
        }
        return resolve();
      });
    });
  };
  try {
    await myGet(query);
  } catch (e) {
    throw ({
      status: 403,
      result: { error: 'Insuficient Permissions' }
    });
  }

  /**
   * New values Partial Validation...
   */
  // ['companies', 'projects'].forEach(relationship => {
  //     if (Object.keys(request.body.data.relationships).includes(relationship)) {
  //         let newValues = request.body.data.relationships[relationship].data.map(v => parseInt(v.id));
  //         let userValue = request.decoded[relationship].map(v => parseInt(v));
  //         let oldValues = ret.result.data.relationships[relationship].data.map(v => parseInt(v.id));

  //         newValues = newValues.filter(v => userValue.includes(v));
  //         newValues = [...newValues, ...oldValues.filter(v => !userValue.includes(v))];

  //         request.body.data.relationships[relationship].data = newValues.map(value => { return { id: value, type: relationship }; });
  //     }
  // });

  // if (request.decoded.roles[0] !== 'sysadmin' && Object.keys(request.body.data.relationships).includes('roles')) {
  //     let allowedRoles = [4, 5, 6];
  //     let newRole = ret.result.data.relationships.roles.data.map(v => parseInt(v.id))[0];

  //     if (!allowedRoles.includes(newRole)) {
  //         request.body.data.relationships.roles.data = ret.result.data.relationships.roles.data;
  //     } else {
  //         request.body.data.relationships.roles.data = [{ id: newRole, type: 'roles' }];
  //     }
  // }
};

/**
 * 1 - Permission helper functions Below
 */

const permissionFunctions = {
  /**
   * This helper function decripts the body of the request if the requests route is accessing an authenticated route and validates its token.
   * It also sets 'needEncryption' flag (in the request) to true if API not running in 'dev' environment
   * @param {Object} req Request
   */
  tokenValidation: async function(req) {
    try {
      // Get the route that client is accessing
      const pathName = '/' + req.params[0];
      // Set 'isAuthenticated' flag to true if the accessing route doest not exist in unauthenticated routes array
      req.isAuthenticated = unauthenticatedRoutes.indexOf(pathName) < 0;
      // Set 'needEncryption' to false by default (this will be changes in case API is not running in 'dev' environment)
      req.needEncryption = false;
      // If the route is authenticated, add some more Promisses to the chain
      if (req.isAuthenticated) {
        if (!req.headers['x-access-token'] || req.headers['x-access-token'] === '') {
          throw ('missing token to validate');
        }
        const result = await authCtrl.validateToken(req.headers['x-access-token']);
        const dbToken = result.token;
        // Save the decoded token in the request
        req.decoded = result.decoded;
        // Decript the body of the request
        await encryption.decriptRequest(req);
        // If the token from DB is different from the token that client used, set 'needNewToken' flag to true
        // to notify client to re-login to update his token
        req.needNewToken = req.headers['x-access-token'] !== dbToken;
      }
    } catch (e) {
      console.error('token validation', e);
      throw (e);
    }
  },
  /**
   * This helper functions adapts 'query' in the request acording to users role and rules described above
   * @param {Object} req Request
   */
  adaptRequest: async function(req) {
    // Adapt query only if there is a valid decoded token
    try {
      if (req.decoded != null) {
        /**
         * method: Requests method (read/write/delete)
         * model: Requests model
         * role: Users Role
         * constraint: Users constraint associated with his role
         */
        const params = {
          method: permissions.permissionTable.parseMethodAccess(req.method.toLowerCase()),
          model: req.params[0],
          role: req.decoded.roles[0],
          constraint: permissions.permissionTable.getQueryConstraint(req.decoded.roles[0], req.params[0])
        };

        // If there is a constraint associated with the user, adapt the query
        if (params.constraint != null) {
          if (params.method === 'read') {
            return await adaptRequestWhenRead(req, params);
          } else if (params.method === 'write' || params.method === 'delete') {
            return await checkForWritePermissions(req, params);
          }
        }
      }
    } catch (e) {
      console.error(e);
      throw (e);
    }
  },
  /**
   * This helper function checks whether user has access rights to certain models. These
   * rules are specified above
   * @param {Object} req Request
   */
  checkAccessRights: async function(req) {
    // Check for access rights if the route is authenticated one
    if (req.isAuthenticated) {
      const method = req.method.toLowerCase();
      const model = req.params[0];
      const role = req.decoded.roles[0];

      const accessRights = permissions.permissionTable.getAccessRights(model, role);
      return accessRights.indexOf(permissions.permissionTable.parseMethodAccess(method)) > -1;
    }

    return true;
  }
};

/**
 * 2 - Permission Middleware Below
 */

module.exports = {
  // Upon response, there might be items with forbidden to access relationships
  // example, if i have company 1 that has project 1 , 2, 3.
  // The user only has access to project 1, but when company 1 get method is called
  // the response comes with project [1,2,3] and not just [1]
  filterResponse: function(decoded, response) {
    filterResponse(decoded, response);
  },
  validate: async function(request) {
    // Validate Token
    let hasPermission;
    let start = +new Date();
    let end;
    try {
      await permissionFunctions.tokenValidation(request);
      end = +new Date();
      console.log('token validation duration', end - start, 'ms');
      start = end;
      hasPermission = await permissionFunctions.checkAccessRights(request);
      end = +new Date();
      console.log('access rights duration', end - start, 'ms');
    } catch (e) {
      throw {
        status: 403,
        result: { error: e }
      };
    }
    // Check permissions rights
    // If user has no permissions, throw an error
    if (!hasPermission) {
      throw {
        status: 403,
        result: { error: 'Insuficient Permissions' }
      };
    }
    try {
      start = +new Date();
      await permissionFunctions.adaptRequest(request);
      end = +new Date();
      console.log('adapt request duration', end - start, 'ms');
      return;
    } catch (e) {
      throw {
        status: e.status || 500,
        result: e.result || { error: e }
      };
    }
  }
};