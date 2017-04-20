#!/usr/bin/env node

const express = require('express');
const app = express();
const execFile = require('child_process').execFile;
const _exec = require('child_process').exec;
const fs = require('fs');
const EventEmitter = require('events');
const util = require('util');
const program = require('commander');
const querystring = require('querystring');
const https = require('https');
const url = require('url');

function MupAutodeployEmitter() {
  EventEmitter.call(this);
}
util.inherits(MupAutodeployEmitter, EventEmitter);

const mupAutoDeployEmitter = new MupAutodeployEmitter();

function executeCommand(cmd, options) {
  return new Promise(function (resolve, reject) {
    execFile(cmd, options, function (err, stdout, stderr) {
      if (err) {
        reject(err);
      } else {
        resolve(stdout);
      }
    });
  });
}

function execCommand(cmd, options) {
  return new Promise(function (resolve, reject) {
    _exec(cmd, options, function (err, stdout, stderr) {
      if (err) {
        reject(err);
      } else {
        resolve(stdout);
      }
    });
  });
}

function sendHttpsPostRequest(protocol, hostname, path, postData) {
  var options = {
    protocol: protocol,
    host: hostname,
    path: path,
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(postData)
    }
  };

  var req = https.request(options);
  req.write(postData);
  req.end();
}

function sendSlackNotification(text) {
  var dataString = 'payload=' + encodeURI('{"text": "' + text + '"}');
  sendHttpsPostRequest(program.slack.protocol, program.slack.hostname, program.slack.path, dataString);
}

function emitLog(logTxt) {
  mupAutoDeployEmitter.emit('log', logTxt);
}

function commandError(error) {
  emitLog(error);
}

function locationExists(locationPath) {
  return new Promise(function (resolve, reject) {
    fs.access(locationPath, fs.F_OK, function (err) {
      if (err) {
        resolve(false);
      } else {
        resolve(true);
      }
    });
  });
}

function deployProject(projectName, command) {
  return new Promise(function (resolve, reject) {
    emitLog('Starting deployment process....');
    emitLog('cwd is ' + program.root + '/' + projectName);
    if(!command) {
      execCommand('cd ' + program.root + '/' + projectName +  ' && mup deploy', [], { cwd: program.root + '/' + projectName }).then(function (stdout) {
        emitLog(stdout);
        emitLog('Deployment process done.');
      }, commandError);
    } else {
      execCommand('cd ' + program.root + '/' + projectName +  ' && npm run ' + command, [], { cwd: program.root + '/' + projectName }).then(function (stdout) {
        emitLog(stdout);
        emitLog('Deployment process done.');
      }, commandError);
    }
  });
}

app.post('/deploy', function (req, res) {
  if(!req.query.token || !req.query.gitUrl) {
    return res.sendStatus(403); 
  }
  if (program.token && req.query.token !== program.token) {
    return res.sendStatus(403);
  } else {
    res.sendStatus(200);
    emitLog('Deployment triggered!');
    var projectNameStartingIndex = req.query.gitUrl.lastIndexOf('/') + 1;
    var projectNameEndingIndex = req.query.gitUrl.lastIndexOf('.git');
    var branch = req.query.branch || 'master';
    var command = req.query.command || '';
    var projectName = req.query.gitUrl.substr(projectNameStartingIndex, projectNameEndingIndex - projectNameStartingIndex);
    locationExists(projectName).then(function (exists) {
      if (!exists) {
        emitLog('Project has not been cloned yet. Cloning....');
        executeCommand('git', ['clone', req.query.gitUrl]).then(function (stdout) {
          emitLog(stdout);
          emitLog('Done cloning');
          emitLog('Checking out branch ' + branch + '....');
          executeCommand('git', ['-C', program.root + '/' + projectName, 'checkout', 'origin/' + branch]).then(function () {
            emitLog(stdout);
            emitLog('Checked out branch ' + branch);
            deployProject(projectName, command);
          }, commandError);
        }, commandError);
      } else {
        emitLog('Checking out branch ' + branch + '....');
        executeCommand('git', ['-C', program.root + '/' + projectName, 'checkout', 'origin/' + branch]).then(function (stdout) {
          emitLog(stdout);
          emitLog('Checked out branch ' + branch);
          emitLog('Pulling changes...');
          executeCommand('git', ['-C', program.root + '/' + projectName, 'pull', 'origin', branch]).then(function () {
            emitLog(stdout);
            emitLog('Pulled changes');
            deployProject(projectName, command);
          }, commandError);
        }, commandError);
      }
    });
  }
});

function onMupAutoDeployLog(logTxt) {
  if (program.verbose) {
    console.log(logTxt);
  }
  if (program.slack) {
    sendSlackNotification(logTxt);
  }
}

program
  .version('0.0.1')
  .arguments('<start>')
  .option('-t --token <secret-token>', 'application access token')
  .option('-p, --port <port-number>', 'port to listen')
  .option('-r, --root <path>', 'root path for code without end slash')
  .option('-v, --verbose', 'display deployment information on standard output')
  .option('-s, --slack <slack-hook-url>', 'send log to the given <slack-hook-url>')
  .action(function (arg) {
    if(arg != "start") {
      program.outputHelp();
    }
    var port = program.port || 80;
    mupAutoDeployEmitter.on('log', onMupAutoDeployLog);
    if (program.slack) {
      program.slack = url.parse(program.slack);
    }
    if(!program.root) {
      program.root = '/opt';
    }
    app.listen(port);
  })
  .parse(process.argv);

if (!process.argv.slice(2).length) {
  program.outputHelp();
}
