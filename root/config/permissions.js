'use strict';
const fs = require('fs');
const path = require('path');

// Public accessible routes
let unauthenticatedRoutes = [
  '/signin',
];

// Freezes roots (just in case)
Object.freeze(unauthenticatedRoutes);

/**
 * 0 - Permission Rules Below
 */

// Permissions are based on actions, read (GET), create (POST), update (PATCH) and delete (DELETE) on roles

// Default permission rules
const defaultRules = {
  admin: ['read', 'create', 'update', 'delete'], // By default admins have full access
  user: ['read'], // by default users just read
  rest: [], // api access by default does not have any authorizations
};

// Custom rules for models or custom routes
const rules = {
  comments: {
    user: ['read', 'create', 'update', 'delete'],
    admin: ['read', 'create', 'update', 'delete'],
    rest: ['read']
  },
  posts: {
    user: ['read', 'create', 'update', 'delete'],
    admin: ['read', 'create', 'update', 'delete'],
    rest: ['read']
  }
};

const parseDbRules = function() {
  const basePath = path.join(__dirname, '../models/db/');
  fs.readdirSync(basePath).forEach(function(file) {
    if (!file.match(/\.js$/)) {
      return;
    }
    file = file.replace('.js', '');
    const model = require(basePath + file)();
    // console.log('parsing permissions for model', file);
    if (model.permissions) {
      rules[file] = model.permissions;
    }
  });
};

const parseRouterRules = function() {
  const basePath = path.join(__dirname, '../routers/');
  fs.readdirSync(basePath).forEach(function(file) {
    if (!file.match(/\.js$/)) {
      return;
    }
    file = file.replace('.js', '');
    // console.log('parsing permissions for router', file);
    const router = require(basePath + file);
    if (router.permissions) {
      rules[file] = router.permissions;
    }
  });
};
console.log('Parsing Database Rules');
parseDbRules();
console.log('Parsing Router Rules');
parseRouterRules();
console.log('Finished parsing rules');

// These constraints are arrays because index 0 is used in decoded token but it
// might not be how the model uses it the attribute
const selfUserConstraint = ['users', 'id'];

const queryConstraints = {
  user: {
    read: {
      users: selfUserConstraint,
    },
    update: {
      users: selfUserConstraint,
      comments: selfUserConstraint,
      posts: selfUserConstraint
    },
    delete: {
      comments: selfUserConstraint
    }
  },
};

module.exports = {
  unauthenticatedRoutes: unauthenticatedRoutes,
  permissionTable: {
    getAccessRights(model, role) {
      let accessRight;

      try {
        accessRight = rules[model][role];
      } catch (ex) {
        accessRight = defaultRules[role];
      }

      return accessRight;
    },
    getQueryConstraint(role, model) {
      try {
        return queryConstraints[role][model];
      } catch (ex) {
        return null;
      }
    },
    parseMethodAccess(method) {
      switch (method.toLowerCase()) {
        case 'get':
          return 'read';
        case 'post':
          return 'create'
        case 'patch':
          return 'update';
        case 'delete':
          return 'delete';
      }
    }
  }
};