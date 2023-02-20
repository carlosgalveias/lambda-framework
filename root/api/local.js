'use strict';

// We are using it locally, set the flag!
process.env.RUNNING_LOCALLY = true;
const fs = require('fs');
const express = require('express'); // call express
const path = require('path');
const bodyParser = require('body-parser');
let environment = process.env.RUNNING_TESTS ? 'dev' : process.argv[2] || 'dev';
const auditLogging = require('../utils/util-auditlogging');

if (environment === 'test' || environment === '--') {
  process.env.RUNNING_TESTS = true;
  environment = 'dev';
}
fs.copyFileSync(
  path.join(__dirname, '..', '.env_' + environment),
  path.join(__dirname, '..', '.env')
);
require('dotenv').config(path.join(__dirname, '..', '.env'));
console.log('environment', environment);
const db = require(path.join(__dirname, '../routers', 'generic.js'));
const initLocal = async function() {
  const app = express(); // define our app using express
  app.use(bodyParser.json({ type: 'application/json', limit: '100mb' }));
  app.use(
    bodyParser.urlencoded({
      extended: true,
      limit: '100mb'
    })
  );

  app.use(function(req, res, next) {
    res.header('Access-Control-Allow-Origin', '*');
    res.header(
      'Access-Control-Allow-Headers',
      'Origin, X-Requested-With, Content-Type, Accept, x-access-token, x-compress-brotli'
    );
    res.header(
      'Access-Control-Allow-Methods',
      'POST, GET, PATCH, DELETE, OPTIONS'
    );
    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    next();
  });

  const port = 8080; // set our port
  const session = require('../utils/util-session');
  const encryption = require('../utils/util-encryption');

  const permissionMiddleware = require('../utils/util-permission-middleware');

  // ROUTES FOR OUR API
  // =============================================================================
  const router = express.Router(); // get an instance of the express Router

  // AUX FUNCTIONS
  // =============================================================================
  const getRouter = (component, id) => {
    const fileName = path.join(
      __dirname,
      '../routers',
      component + (id ? '-id.js' : '.js')
    );
    console.log({ fileName });
    if (fs.existsSync(fileName)) {
      console.log('returning require', fileName);
      return require(fileName);
    }

    return db;
  };

  const callRouteMethod = (route, method, request, response) => {
    try {
      route[method](request, async ret => {
        if (ret.status === 200 && ret.result.data && request.decoded) {
          if (request.decoded.roles.includes('developer') || request.decoded.roles.includes('auditor')) {
            permissionMiddleware.filterResponse(request.decoded, ret.result);
          }
        }
        if (
          ret.status === 200 &&
          method === 'patch' &&
          ret.result.data.type === 'users'
        ) {
          await session.updateUserToken(ret.result.data);
        }
        // Remove password from response
        if (
          ret.status === 200 &&
          ret.result.data &&
          ret.result.data.length &&
          ret.result.data[0].type === 'users'
        ) {
          ret.result.data.forEach(d => {
            if (d.attributes.password) {
              delete d.attributes.password;
            }
          });
        }

        // Notify client to re-login if necessary
        if (request.needNewToken) {
          ret.result.relogin = true;
        }
        auditLogging.log(request, ret);
        const now = new Date().getTime();
        if (request.decoded) {
          const rf = request.decoded.rf;
          console.log({ now, rf, decoded: request.decoded });
        }
        if (ret.status === 200 && request.decoded && (!request.decoded.rf || request.decoded.rf < new Date().getTime())) {
          if (typeof(ret.result) === 'object') {
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

        // Encript the return value
        encryption.encriptResponse(ret.result, request).then(encoded => {
          // Send the encripted value
          response.status(ret.status).send(encoded);
        });
      });
    } catch (ex) {
      // eslint-disable-next-line no-throw-literal
      throw {
        status: 500,
        message: 'Error while calling router: ' + JSON.stringify(ex)
      };
    }
  };

  // more routes for our API will happen here
  router.all('/*/:id', function(req, res) {
    req.orm = db;
    res.header('Access-Control-Allow-Origin', '*');
    if (req.headers['x-compress-brotli']) {
      res.header('x-compress-brotli', true);
    }
    // Validate Permission and adapt the request according to user role
    permissionMiddleware
      .validate(req)
      .then(() => {
        const id = parseInt(req.params.id);
        console.log('query after validate', req.query);
        if (req.query.id && Array.isArray(req.query.id)) {
          // So here we are querying something like /api/companies/3 , but lets say
          // that the user does not have permission to see the company 3.
          // The result of the permission middleware is the injection of the query
          // of all avaialble items , lets say the query becomes [1,4,5]
          // So we need to check if the query we want is included in our array.
          // Additionally , if we are doing a call on a specific id, the id query should be removed
          if (!req.query.id.includes(id) && !req.query.id.includes('' + id)) {
            // eslint-disable-next-line no-throw-literal
            throw {
              status: 404,
              message: 'Not Found'
            };
          }
          delete req.query.id;
        }

        const component = req.params['0'].replace(/\/[a-zA-Z0-9]+$/, '');
        const method = req.method.toLowerCase();
        const route = getRouter(component, req.params.id);

        callRouteMethod(route, method, req, res);
      })
      .catch(ex => {
        // Log the error
        console.error('Error from Promise chain for routes -> "/*":', ex);

        // Send the respons with associated status code and message
        return res.status(ex.status).send({
          success: false,
          message: ex.message
        });
      });
  });

  router.all('/*', async function(req, res) {
    req.orm = db;
    res.header('Access-Control-Allow-Origin', '*');
    if (req.headers['x-compress-brotli']) {
      res.header('x-compress-brotli', true);
      res.header('Access-Control-Expose-Headers', ['Content-Type', 'Content-length', 'x-compress-brotli']);
    }
    // Validate Permission and adapt the request according to user role
    permissionMiddleware
      .validate(req)
      .then(() => {
        const component = req.params['0'].replace(/\/[a-zA-Z0-9]+$/, '');
        const method = req.method.toLowerCase();
        const route = getRouter(component);

        callRouteMethod(route, method, req, res);
      })
      .catch(ex => {
        // Log the error
        console.error('Error from Promise chain for routes -> "/*": ', ex);

        // Send the respons with associated status code and message
        return res.status(ex.status).send({
          success: false,
          message: ex.message
        });
      });
  });

  // REGISTER OUR ROUTES -------------------------------
  // all of our routes will be prefixed with /api
  app.use('/api', router);
  // START THE SERVER
  // =============================================================================
  if (!process.env.RUNNING_TESTS) {
    app.listen(port);
  }
  console.log('Magic happens on port ' + port);
};

initLocal();