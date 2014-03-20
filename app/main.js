// Simple websocket server demo
var response = require("ringo/jsgi/response");
var {Parser} = require('ringo/args');
var fs = require('fs');
var system = require('system');
var {JavaEventEmitter} = require('ringo/events');
var HttpServer = require('ringo/httpserver').Server;

var {GofServer} = require('./gofserver');
var {GofClient} = require('./gofclient');

var jsgiApp = function(req) {
    var watcherTemplate = fs.read(module.resolve('./watcher.html'));
    return response.html(watcherTemplate);
}

var startServer = function(opts) {
    var gofServer = new GofServer({
        boardSize: opts.size,
        boardSizePerClient: opts.clientsize,
        DEBUG: opts.debug
    });

    var httpServer = new HttpServer({
        port: opts.port,
        host: opts.host
    });
    httpServer.getDefaultContext().serveApplication(jsgiApp)

    // forward websocket to gofServer
    function onClientConnect(conn) {
        conn.addListener("open", function() {
            gofServer.onConnect(conn);
        });
        conn.addListener("message", function(message) {
            gofServer.onMessage(conn, message);
        });
        conn.addListener("close", function() {
            gofServer.onDisconnect(conn);
        });
    }

    console.log('HTTP server up http://' + opts.host + ':' + opts.port)
    httpServer.getDefaultContext().addWebSocket("/gofsocket", onClientConnect);
    console.log('Websocket server waiting for connections');
    httpServer.start();
};

var startClients = function(opts) {
    var websocketURL = "ws://" + opts.host + ":" + opts.port + "/gofsocket";

    var factory = new Packages.org.eclipse.jetty.websocket.WebSocketClientFactory();
    factory.start();

    console.log('Connecting to server ', websocketURL)
    var statusClient = factory.newWebSocketClient();
    var onTextMessage = new JavaEventEmitter(org.eclipse.jetty.websocket.WebSocket.OnTextMessage);
    onTextMessage.on('open', function(conn) {
        console.log('Querying server for required number of clients');
        conn.sendMessage('status');
    })
    onTextMessage.on('message', function(message) {
        var {boardSize, boardSizePerClient} = JSON.parse(message);
        console.log('Starting clients')
        var requiredClients = Math.pow(boardSize/ boardSizePerClient, 2);
        for (var i = 0; i < requiredClients ; i++) {
            var client = factory.newWebSocketClient();
            var gofClient = new GofClient({
                updateSpeed: opts.speed,
                patternFile: opts.pattern,
                websocketClient: client,
                websocketURL: websocketURL,
                DEBUG: opts.debug
            });
        }
        console.log('All ' + requiredClients + ' clients started')
    })
    statusClient.open(
        new java.net.URI(websocketURL),
        onTextMessage.impl,
        10, java.util.concurrent.TimeUnit.SECONDS
    );
}

if (require.main == module) {
    // catch eventemitter errors
    var engine = require('ringo/engine')
    engine.getCurrentWorker().setErrorListener(function(e) {
       console.error('Worker error', e)
    });

    // log config
    require('ringo/logging').setConfig(getResource('./config/log4j.properties'))

    var parser = new Parser();
    parser.addOption(null, 'server', null, 'Start server');
    parser.addOption(null, 'clients', null, 'Start clients');
    parser.addOption('h', 'host', "ip address", 'Server address. (default: 127.0.0.1)');
    parser.addOption('p', 'port', "port number", 'Server port. (default: 8080)');
    parser.addOption('w', 'size', "number", 'Size of board. (default: 30)');
    parser.addOption('c', 'clientsize', "number", 'Size of client boards. (default: 5)');
    parser.addOption('s', 'speed', "seconds", 'Maximum client update speed. (default: 30)');
    parser.addOption('d', 'debug', null, 'Output debug messages. (default: off)');
    parser.addOption(null, 'pattern', "name of pattern", 'Pattern filename (default: none).');
    var args = system.args;
    args.shift();
    var opts = parser.parse(args, {
        size: 30,
        clientsize: 5,
        host: '127.0.0.1',
        port: '8080',
        speed: 3,
        debug: false
    });

    verifyOptions(opts);

    if (opts.server) {
        startServer(opts);
    } else {
        startClients(opts);
    }
}


function verifyOptions(opts) {
    if ( (!opts.server && !opts.clients) || (opts.server && opts.clients)) {
        optionsError('Must either specify --server or --clients');
    }
    opts.size = parseInt(opts.size, 10);
    opts.clientsize = parseInt(opts.clientsize, 10);
    opts.speed = parseInt(opts.speed, 10);

    if (opts.clientsize > opts.size) {
        optionsError('clientsize must be smaller than size')
    }
    if (opts.size % opts.clientsize !== 0) {
        optionsError('size must be divisible by clientsize.')
    }
    var patternFile = null;
    if (opts.patternFile) {
        patternFile = module.resolve(opts.patternFile);
        if (fs.exists(patternFile) == false) {
            optionsError('Patternfile ' + opts.patternFile + 'not found');
        }
    }
}


function optionsError(msg) {
    print ('Websocket stress test - distributed Game of Life')
    print ('')
    print ('Available options:')
    print ('')
    print(parser.help());
    print ('');
    print (' Server only: --size, --clientsize');
    print (' Client only: --speed, --pattern')
    print ('')
    print('Example invocations:');
    print(' ')
    print ('  # Default settings')
    print ('  ringo app/main.js --server');
    print ('  ringo app/main.js --clients');
    print (' ');
    print ('  # Load pulsar pattern and set update speed = 1 sec')
    print ('  ringo app/main.js --server');
    print ('  ringo app/main.js --clients --pattern pulsar --speed 1');
    print ('---------')
    print ('ERROR: ', msg);
    system.exit(1)
}
