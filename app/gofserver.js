/** game of life websocket server

    states:
      1) wait for all clients to connect
      2) assign offsets to clients
      3) tell clients to start working
      4) continously relay state updates
      5) if all clients disconnect: reset to 1)

**/

var $a = require("ringo/utils/arrays");

export('GofServer');

var STATES = {
    WAIT: 0,
    RUN: 2
}

var GofServer = function({boardSize, boardSizePerClient, DEBUG}) {
    this.boardSize = boardSize;
    this.boardSizePerClient = boardSizePerClient;
    // worker connections
    var connections = [];
    // watch connections receive all updates
    var globalWatchConnections = [];
    var state = STATES.WAIT;

    // how many clients do we need for the calcuation to start?
    var requiredClients = Math.pow(boardSize / boardSizePerClient, 2);

    // which connetions deals with which part ("offset") of the board?
    var offsetToConnection = {};
    // which neighbours are interested in a particular offset of the board?
    var offsetToNeighbours = {};

    // reset server to accept fresh worker connections
    var reset = function() {
        offsetToNeighbours = {};
        offsetToConnection = {};
        state = STATES.WAIT;
    };

    // only for debug output
    var newestStep = 0;

    this.onConnect = function(conn) {};

    this.onDisconnect = function(conn) {
        if (connections.indexOf(conn) > -1) {
            $a.remove(connections, conn);
            DEBUG && console.log('Worker client disconnected. New count:', connections.length);
        } else {
            $a.remove(globalWatchConnections, conn);
            console.log('Watch client disconnected. New count:', globalWatchConnections.length);
        }
        conn = null;
        if (connections.length <= 0) {
            reset();
            console.log('All clients disconnected: resetting to WAIT state');
        }
    }

    // for the client receiving an update, the offset
    // as seen from the the sending client is inverted.
    var invertOffset = function(offset) {
        return [
            -offset[0],
            -offset[1]
        ]
    }

    this.onMessage = function(conn, message) {
        // watch always allowed
        if (message === 'watch') {
            globalWatchConnections.push(conn);
            console.log('Watch client connected, #', globalWatchConnections.length);
        } else if (message === 'status') {
            conn.send(JSON.stringify({
                boardSize: boardSize,
                boardSizePerClient: boardSizePerClient
            }));
            DEBUG && console.log('sent server status');
        } else if (state === STATES.WAIT) {
            //do you want to work?
            if (message === 'work') {
                connections.push(conn);
                DEBUG && console.log('Worker client connected, #', connections.length);
                // enough clients connected?
                if (connections.length === requiredClients) {
                    console.log('All', requiredClients, ' clients are connected');
                    subscribeNeighbours();
                }
            }
        } else if (state === STATES.RUN) {
            var msg = JSON.parse(message);
            // msg from a worker?
            if (connections.indexOf(conn) > -1) {
                var offset = msg.offset;
                if (msg.step > newestStep) {
                    newestStep = msg.step;
                    if (newestStep % 10 === 0) {
                        console.log('Saw first message for step', newestStep);
                    }
                }
                DEBUG && console.log('Recieved msg length', msg.length , 'from ', offset);
                // if that offset has neighbours, forward them the message
                if (offsetToNeighbours[offset]) {
                    offsetToNeighbours[offset].forEach(function(neighbour) {
                        neighbour.connection.send(JSON.stringify({
                            step: msg.step,
                            board: msg.board,
                            absoluteOffset: offset,
                            offset: invertOffset(neighbour.relativeOffset)
                        }));
                    });
                };
                // watch connections receive all updates
                globalWatchConnections.forEach(function(conn) {
                    conn.send(message);
                });
            } else {
                // ignore watcher's messages
                console.error('ignoring watcher message', message)
            }
        } else {
            console.error('Received invalid message', state);
        }
    }

    var randomInt = function(min, max){
        return min + parseInt(Math.random() * (max-min+1), 10);
    };

    // turn string into offset coords array
    var toOffset = function(str) {
        var p = str.split(',');
        return [
            parseInt(p[0], 10),
            parseInt(p[1], 10)
        ]
    }

    var subscribeNeighbours = function() {
        console.log('Assigning board parts to connections')
        // randomly assign each connection an offset
        var cons = connections.slice(0);
        for (var i = 0; i < boardSize; i+= boardSizePerClient) {
            for (var j = 0; j < boardSize; j+= boardSizePerClient) {
                var offset = [i, j];
                var conn = cons.splice(randomInt(0, cons.length-1), 1)[0];
                offsetToConnection[offset] = conn;
                conn.send(JSON.stringify({assignOffset: offset}));
            }
        };
        // inform each client about the number of neighbours he has
        // (the client must wait for all its neighbours updates before
        //   he can step)
        // Here we also precalcuate offsetToNeighbours, which tells us
        // which clients are neighbours of a particular offset. This will
        // come in handy to relay incoming messages to interested clients.
        console.log("Subscribing boards to their neighbours")
        var neighbourOffsets = [[-1, 0], [0, -1], [1, 0], [0, 1],
        [-1, -1], [1,1], [-1, 1], [1, -1]];
        Object.keys(offsetToConnection).forEach(function(key) {
            var offset = toOffset(key);
            var neighbourCount = 0;
            neighbourOffsets.forEach(function(neighbourOffset) {
                var neighbour = [
                    offset[0] + (neighbourOffset[0] * boardSizePerClient),
                    offset[1] + (neighbourOffset[1] * boardSizePerClient)
                ];
                if (neighbour.toString() in offsetToConnection) {
                    neighbourCount++;
                    if (!offsetToNeighbours[offset]) {
                        offsetToNeighbours[offset] = [];
                    }
                    offsetToNeighbours[offset].push({
                        connection: offsetToConnection[neighbour],
                        relativeOffset: neighbourOffset
                    });
                    DEBUG && console.log ('offset', offset, '--', neighbourOffset ,'-> neighbour:', neighbour);
                }
            })
            // tell connection how many neighbours it has
            offsetToConnection[offset].send(JSON.stringify({
                neighbourCount: neighbourCount,
                boardSizePerClient: boardSizePerClient
            }))
        });

        // tell clients to start calculating
        state = STATES.RUN;
        connections.forEach(function(conn, idx) {
            conn.send(JSON.stringify({run: true}))
        });
        console.log('Sent GO to client');
    }

    return this;
}
