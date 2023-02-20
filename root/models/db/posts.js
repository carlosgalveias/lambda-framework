'use strict';
module.exports = function (conn) {
  return {
    identity: 'posts',
    connection: conn,
    attributes: {
      title: {
        type: 'string'
      },
      content: {
        type: 'string'
      },
      user: {
      	mode: 'users'
      }
    },
    permissions: {
      admin: ['read', 'write', 'delete'],
      user: ['read', 'write', 'delete']
      rest: ['read']
    }
  };
};