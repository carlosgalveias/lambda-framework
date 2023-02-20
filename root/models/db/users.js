'use strict';
module.exports = function(conn) {
  return {
    identity: 'users',
    connection: conn,
    attributes: {
      name: {
        type: 'string',
        index: true
      },
      password: {
        type: 'string',
        required: true
      },
      email: {
        type: 'string',
        unique: true,
        index: true
      },
      attempts: {
        type: 'integer'
      },
      lastattempt: {
        type: 'datetime'
      },
      role: {
        model: 'roles',
      },
      active: {
        type: 'boolean',
        defaultsTo: true,
        index: true
      }
    },
    permissions: {
      user: ['read', 'write', 'delete'],
      admin: ['read', 'write', 'delete'],
      rest: ['read']
    }
  };
};