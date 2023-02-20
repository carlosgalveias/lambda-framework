'use strict';
const owlc = require('./util-wrapper.js').ow;
const owsk = null

const makeCall = async function(ow, params) {
  return ow.actions.invoke(params);
};

const callFunction = async function(service, args, direct, nonBlocking) {
  console.log('callfunction->', service, direct, nonBlocking)
  try {
    let ow;
    let local;
    if (!owsk || process.env.RUNNING_LOCALLY || direct) {
      local = true;
      ow = owlc;
      console.log('Using Local OW');
    } else {
      console.log('Using Call OW');
      local = false;
      ow = owsk;
    }

    try {
      const data = await makeCall(ow, { name: service, blocking: !nonBlocking && true, result: true, params: args });
      return data && (data.result || data.result === null) ? data.result : data;
    } catch (e) {
      console.error('callfunction->catch', { message: e.message, status: e.status || e.statusCode });
      throw (e);
    }
  } catch (e) {
    console.error('callFunction->catch->final', e);
    throw (e);
  };
};

module.exports = callFunction;