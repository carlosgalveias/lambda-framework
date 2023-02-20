'use strict';

const jwt = require('jsonwebtoken'); // used to create, sign, and verify tokens
const callFunction = require('./util-callFunction.js');
const uuid = require('uuid').v4;
const tokenHash = process.env.TOKEN_HASH || 'LAMBDA';
const cachedTokens = {};

function buildCryptoKey() {
  return uuid();
}

function buildExpiryDate(totalSeconds) {
  totalSeconds = totalSeconds || 1800; // Token is valid only for 30 minutes
  const time = +new Date(); // milliseconds
  const expiryDate = new Date(time + totalSeconds * 1000);
  return {
    date: expiryDate,
    seconds: totalSeconds
  };
}

function decriptToken(token) {
  return jwt.verify(token, tokenHash);
}

function buildTokenData(payload, expirySeconds) {
  console.log('buildTokenData', payload)
  /* eslint-disable camelcase */
  expirySeconds = expirySeconds || 1800;
  const date = buildExpiryDate(expirySeconds);
  const rf = new Date().getTime() + 600000;
  payload.rf = rf;
  const token = jwt.sign(payload, tokenHash, {
    expiresIn: date.seconds
  });
  const token_expiry_date = date.date.toISOString();
  const crypto_key_expiry_date = date.date.toISOString();
  return { token, token_expiry_date, crypto_key_expiry_date, rf };
  /* eslint-enable camelcase */
}

function resetToken(decoded) {
  delete decoded.rf;
  delete decoded.iat;
  delete decoded.exp;
  return buildTokenData(decoded);
}

const validateToken = function(req) {
  const token = req.headers['x-access-token'];

  // verifies secret and checks exp
  return new Promise((resolve, reject) => {
    jwt.verify(token, tokenHash, function(err, decoded) {
      if (err) {
        return reject(err);
      } else {
        // if everything is good, save to request for use in other routes
        return resolve(decoded);
      }
    });
  });
};

const createUserToken = async function(user) {
  const tokenPayload = {
    id: user.id,
    role: user.role
  };
  const tokenData = buildTokenData(tokenPayload);
  const createSessionQuery = {
    type: 'write',
    table: 'sessions',
    data: {
      user: user.id,
      token: tokenData.token,
      token_expiry_date: tokenData.token_expiry_date,
      crypto_key_expiry_date: tokenData.crypto_key_expiry_date,
      rf: tokenData.rf
    }
  };
  await callFunction('storage-db', createSessionQuery, true);
  return {
    token: tokenData.token
  };
};

const validateTokenActive = function(token) {
  return new Promise((resolve, reject) => {
    jwt.verify(token, tokenHash, function(err, decoded) {
      if (err) {
        return resolve(false);
      } else {
        // if everything is good, save to request for use in other routes
        return resolve(true);
      };
    });
  });
};

const checkSession async function(token) {
  if (!token) {
    throw 'No token provided';
  }
  const validToken = await validateTokenActive(token);
  if (!validToken) {
    if (cachedTokens[token]) {
      delete cachedTokens[token];
    }
    throw 'error in token';
  }
  if (cachedTokens[token]) {
    return cachedTokens[token];
  }
  let decoded;
  try {
    decoded = decriptToken(token);
  } catch (e) {
    console.error('error decrpting token', e);
    throw e;
  }
  const querySessionUser = {
    type: 'readSort',
    table: 'sessions',
    query: {
      id: decoded.id,
      token,
      limit: 1
    },
    sort: 'id DESC'
  };

  try {
    // Session tokens are cached but if not exists, getting it will probably crete a new connection
    // in that case it will take from 1 to 2s so chances are that if we call storage-db externally
    // it is faster, so dont use true here
    const querySessionResult = await callFunction(
      'storage-db',
      querySessionUser,
      true
    );
    if (!querySessionResult || !querySessionResult.length) {
      throw ('token does not exist');
    }
    cachedTokens[token] = {
      decoded: decoded,
      token: querySessionResult && querySessionResult[0] ? querySessionResult[0].token : token,
      user: querySessionResult && querySessionResult[0] ? querySessionResult[0].user : null
    };
    return cachedTokens[token];
  } catch (e) {
    console.error('error caught at calling storage-db at checkSession', e);
    throw e;
  }
};

const getTokenParams = function(token) {
  return jwt.decode(token);
};

const buildToken = async function(user, config) {
  const getSessionQuery = {
    type: 'readSort',
    table: 'sessions',
    query: {
      user: user.id,
      limit: 1
    },
    sort: 'id DESC'
  };
  const queryResult = await callFunction('storage-db', getSessionQuery, true);
  if (queryResult && queryResult[0] && await validateTokenActive(queryResult[0].token)) {
    return {
      token: queryResult[0].token
    };
  } else {
    // if everything is good, save to request for use in other routes
    const newData = await createUserToken(user);
    return newData;
  }
};

const updateUserToken = async function(user) {
  return createUserToken(user);
};


const getActiveSession = async function(decoded) {
  console.log('getActiveSession');
  try {
    const payload = {
      type: 'readSort',
      table: 'sessions',
      query: {
        user: decoded.id,
        rf: { '>': new Date().getTime() },
        limit: 1
      },
      sort: 'id DESC'
    };
    const activeSession = await callFunction('storage-db', payload, true);
    if (activeSession && activeSession.length) {
      return { token: activeSession[0].token };
    }
  } catch (e) {
    console.error(e);
  }
  return null;
};

const changeToken = async function(req) {
  const decoded = req.decoded;
  const tokenData = resetToken(decoded);
  const sessionPayload = {
    token: tokenData.token,
    token_expiry_date: tokenData.token_expiry_date,
    rf: tokenData.rf,
    user: decoded.id
  };
  const payload = {
    type: 'write',
    table: 'sessions',
    data: sessionPayload
  };
  await callFunction('storage-db', payload, true);
  return { token: tokenData.token };
};


const refreshSession = async function(req) {
  // check if our token already has a refresh token
  // if not check db and put in cache
  // if not create refresh token and put in cache
  console.log('refreshing session');
  const token = req.headers['x-access-token'];
  const cached = cachedTokens[token];
  if (cached && cached.refreshToken && cached.refreshToken.rf > +new Date().getTime()) {
    console.log('returning cached token');
    return cached.refreshToken;
  } else {
    console.log('getting active sessions');
    let refreshToken = await getActiveSession(req.decoded);
    if (!refreshToken) {
      console.log('no active session , generating new token pair');
      refreshToken = await changeToken(req);
    }
    cachedTokens[token].refreshToken = refreshToken;
    return refreshToken;
  }
};

const session = {
  getTokenParams,
  validateToken,
  checkSession,
  getKey,
  buildToken,
  updateUserToken,
  refreshSession
};

module.exports = session;