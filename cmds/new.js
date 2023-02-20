/* new commander component
 * To use add require('../cmds/init.js')(program) to your commander.js based node executable before program.parse
 * Creates the new project folders, etc
 */
'use strict';
const inquirer = require('inquirer');
const fs = require('fs-extra');
const path = require('path');
const colors = require('colors'); //jshint ignore:line
const exec = require('child_process').execSync;
const packages = require(path.join(__dirname, '../config/packages.json'))
module.exports = function(program) {
  program.command('new')
    .version('0.0.0')
    .description('Creates a new AWS Lambda Cloud Project')
    .action(function() {
      // Check if current directory is already a cognus package
      if (fs.existsSync('aws.json')) {
        throw new Error('You need to create a project in a clean folder.');
      }
      // Get path name
      let defaults = {
        application: path.basename(process.cwd())
      };
      // Start questions
      inquirer.prompt(
          [{
            name: 'application',
            message: 'Please name your application',
            default: defaults.application,
            validate: (input) => {
              return input.match(/(\:|\||\{|\}|\.|\,|'|;|:|\[|\]|\\|\/|=|\+|%|^|&|\*|#|@|!|`|~)/g)
                .length === 1;
            }
          }, {
            name: 'applicationDescription',
            message: 'Please desribe your application:',
            default: 'The most awesome application in the world'
          }, {
            name: 'author',
            message: 'Who is the author?',
            default: ''
          }, {
            name: 'email',
            message: 'What is their email?',
            default: 'email@example.com'
          }, {
            name: 'url',
            message: 'What is their website/url?',
            default: 'www.website.com'
          }, {
            name: 'repo',
            message: 'What is source repo type?',
            default: 'git'
          }, {
            name: 'repoUrl',
            message: 'What is source repo url?'
          }])
        .then((answers) => {
          // get our current folder
          let cwd = process.cwd();
          // Create new application folder
          console.log('Creating application folder'.green);
          if (!fs.existsSync(path.join(cwd, answers.application))) {
            fs.mkdirSync(path.join(cwd, answers.application));
          }
          console.log('Creating Base Files'.green);
          // Copy the root folder with all the generic stuff
          fs.copySync(path.join(__dirname, '..', 'root'), path.join(cwd, answers.application));
          // Create cognus.json
          fs.writeFileSync(path.join(cwd, answers.application, 'aws.json'), JSON.stringify(answers, null, 2));
          // Create /package.json
          fs.writeFileSync(path.join(cwd, answers.application, 'package.json'), JSON.stringify({
            name: answers.application,
            version: '0.0.0',
            description: answers.applicationDescription,
            private: true,
            scripts: {
              "test": "node ./node_modules/mocha/bin/mocha test --timeout 30000 --recursive --exit",
              "coverage": "nyc --reporter=lcov npm run test",
              "start": "node api/local.js",
              "dev": "nodemon --inspect api/local.js"
            },
            author: {
              name: answers.author,
              email: answers.email,
              url: answers.url
            },
            repository: {
              type: answers.repo,
              url: answers.repoUrl
            },
            license: '-',
            bugs: '-',
            'dependencies': packages.dependencies,
            'devDependencies': packages.devDependencies
          }, null, 2));
          process.chdir(path.join(cwd, answers.application));
          // initialize git
          console.log('Running git init'.green);
          console.log(exec('git init')
            .toString());
          // // Run NPM install
          console.log('Running npm install'.green);
          console.log(exec('npm install')
            .toString());
          process.chdir(path.join(cwd));
          // All done
          console.log('Complete!'.green);
        });
    });
};