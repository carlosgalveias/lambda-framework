'use strict';

console.log('@AuthCtrl->', 'loading session utils');
const session = require('./util-session');
console.log('@AuthCtrl->', 'loading crypto');
const crypto = require('crypto');
console.log('@AuthCtrl->', 'loading callFunction');
const callFunction = require('./util-callFunction');
console.log('@AuthCtrl->', 'finished imports');

const _cypher = function(key, input) {
  return new Promise((resolve, reject) => {
    try {
      const cipher = crypto.createCipher('sha256', key);
      let encrypted = '';
      cipher.on('readable', () => {
        const data = cipher.read();
        if (data) {
          encrypted += data.toString('hex');
        }
      });
      cipher.on('end', () => {
        return resolve(encrypted);
      });
      cipher.write(input);
      cipher.end();
    } catch (e) {
      console.error('error on _cypher', { key, input });
      return reject(e);
    }
  });
};

const _decypher = function(key, input) {
  return new Promise((resolve, reject) => {
    if (input === '0') {
      return resolve(0);
    }
    if (!input) {
      return resolve(input);
    }
    try {
      const decipher = crypto.createDecipher('sha256', key);

      let decrypted = '';
      decipher.on('readable', () => {
        const data = decipher.read();
        if (data) { decrypted += data.toString('utf8'); }
      });
      decipher.on('end', () => {
        return resolve(decrypted);
      });
      decipher.on('error', e => {
        return reject(e)
      })
      decipher.write(input, 'hex');
      decipher.end();
    } catch (e) {
      console.error('error on _decypher', { key, input });
      return reject(e);
    }
  });
};

const _createHash = function(key) {
  return new Promise((resolve, reject) => {
    try {
      const hash = crypto.createHash('sha256');
      hash.on('readable', () => {
        const data = hash.read();
        if (data) {
          return resolve(data.toString('hex'));
        }
      });
      hash.write(key);
      hash.end();
    } catch (e) {
      return reject(e);
    }
  });
};

const salt = async function(id, createdAt, data) {
  const date = +new Date(createdAt);
  const multiplier = Math.pow(id, 2);
  const sqr = '' + Math.sqrt(multiplier * date);
  const key = await _createHash(sqr);
  if (!data || data === '') {
    return data;
  }
  if (typeof(data) === 'object') {
    data = JSON.stringify(data);
  } else if (typeof(data) === 'number') {
    data = '' + data;
  }
  const encrypted = await _cypher(key, data);
  return encrypted;
};

const unsalt = async function(id, createdAt, data) {
  if (!data || data === '') {
    return data;
  }
  const date = +new Date(createdAt);
  const multiplier = Math.pow(id, 2);
  const sqr = '' + Math.sqrt(multiplier * date);
  const key = await _createHash(sqr);
  let decrypted = await _decypher(key, data);
  try {
    decrypted = JSON.parse(decrypted);
  } catch (e) {
    // shhh e
  }
  if (typeof decrypted === 'string' && decrypted.match(/^\d*$/)) {
    decrypted = parseInt(decrypted);
  }
  if (typeof decrypted === 'string' && decrypted.match(/^\d*\.\d*?$/)) {
    decrypted = parseFloat(decrypted);
  }
  return decrypted;
};

/**
 * Searched DB for user with appropriate email
 * @param {String} email email of the user to find
 */
async function findUserByEmail(email) {
  const payload = {
    type: 'read',
    table: 'users',
    query: { email }
  }
  const users = await callFunction('storage-db', payload, true);
  if (!users || !users.length) {
    throw new Error('User Not found')
  }
  return users[0];
}

/**
 * Searched DB for user with appropriate id
 * @param {String} id id of the user to find
 */
async function findUserById(id) {
  const payload = {
    type: 'read',
    table: 'users',
    query: { id }
  }
  const users = await callFunction('storage-db', payload, true);
  if (!users || !users.length) {
    throw new Error('User Not found')
  }
  return users[0];
}

/**
 * Inactivate User by ID
 * @param {String} id id of the user to find
 */
async function inactivateUser(id) {
  await callFunction('storage-db', {
    type: 'update',
    table: 'users',
    query: {
      id
    },
    data: {
      active: false
    }
  }, true);
  return true;
}


/**
 * Changes the user password
 * @param {*} userId
 * @param {*} password
 */
const changePassword = async (id, password) => {
  const user = await getUserFromId(id);
  if (user == null) {
    throw new Error('No user found for id ' + id);
  }
  const createdAt = user.createdAt;
  password = await auth.salt(id, createdAt, password);
  await callFunction('storage-db', {
    type: 'update',
    table: 'users',
    query: {
      id: id
    },
    data: {
      password
    }
  }, true);
};

/**
 * Checks if the incomming password is compatible with the password in the DB
 * @param {String} input password to validate
 * @param {String} password encripted password that input will be compared to
 */
function validatePassword(input, password) {
  return encrypt.oneWayCompare(input, password);
}

/**
 * Checks whether the payload has all necessary fields to login.
 * This will throw an error on first missing field found
 * @param {Object} payload
 */
function validatePayload(payload) {
  const requiredProperties = ['email', 'password'];
  requiredProperties.forEach(property => {
    if (payload[property] == null || payload[property] === '') {
      throw new Error('Missing required fields');
    }
  });
}

console.log('@AuthCtrl->', 'preparing export object');
const auth = {
  inactivateUser,
  validatePayload,
  validatePassword,
  changePassword,
  getUserIdFromEmail,
  getUserIdFromID,
  salt,
  unsalt,
  async signIn(req) {
    try {
      const payload = req.body;
      await validatePayload(payload);
      const user = await findUserByEmail(payload.email);
      const unsaltedPassword = await unsalt(user.data.id, user.data.createdAt, user.data.password);
      if (!validatePassword(payload.password, unsaltedPassword)) {
        throw new Error('Invalid Password')
      }
      const token = await session.buildToken(user);
      delete user.password;
      return {
        user,
        token
      }
    } catch (e) {
      throw new Error({
        status: 401,
        error: e.message
      })
    }
  },
  async validateToken(token) {
    try {
      return await session.checkSession(token);
    } catch (e) {
      throw new Error({ status: 401, error: 'Invalid Token: ' + e, message });
    }
  }
};
console.log('@AuthCtrl->', 'exporting');
module.exports = auth;