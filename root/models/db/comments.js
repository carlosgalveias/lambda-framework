'use strict';
module.exports = function(conn) {
  return {
    identity: 'comments',
    connection: conn,
    attributes: {
      content: {
        type: 'string'
      },
      post: {
        model: 'posts'
      },
      user: {
        model: 'users'
      }
    },
    permissions: {
      admin: ['read', 'write', 'delete'],
      user: ['read', 'write', 'delete']
      rest: ['read']
    }
  };
};