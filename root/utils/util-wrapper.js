'use strict';
const path = require('path');
const wrapper = {
  ow: {
    actions: {
      invoke: async function(args) {
        if (!args || !args.name) {
          throw (new Error('ow: no function name to invoke'));
        }
        const name = args.name;
        try {
          const fn = require(path.join(__dirname, '..', 'controllers', name + '.js'));
          return await fn(args.params);
        } catch (e) {
          console.error(e);
          throw (e);
        }
      }
    }
  }
};
module.exports = wrapper;