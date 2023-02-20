'use strict';

// Requirements
const authCtrl = require('../utils/util-auth');

const letmein = {
  post(req, res) {
    console.log('Trying to Sign In');
    authCtrl
      .signIn(req)
      .then(result => {
        console.log('Sign In successful: ');
        return res({ status: 200, result: { data: result } });
      })
      .catch(ex => {
        console.log('Erro while trying to Sign In: ', ex);
        return res({ status: ex.status, result: ex });
      });
  }
};

module.exports = letmein;