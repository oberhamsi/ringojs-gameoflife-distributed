var {JavaEventEmitter} = require('ringo/events');
var fs = require('fs');
var $o = require('ringo/utils/objects');

export('GofClient');

var STATES = {
    CONNECT: 0,
    RUN: 1
};
var GofClient = function({websocketClient, updateSpeed, websocketURL, patternFile, DEBUG}) {

    // our part of the board
    var board = [];
    // received neighbour boards; we have to sets of boards:
    // one for the current state and one for the next state
    var receivedBoards = [];
    // we get this from server
    var boardSizePerClient = null;
    // our own offset within the whole board - this is
    // only used for debugging. we get it from server.
    var offset = [];
    // the step for which we last sent our state
    // and are still collecting updates from neighbours
    var step = 0;
    // number of neighbours we have to wait for before we
    // can step
    var neighbourCount = undefined;

    var pattern = null;
    var patternOffset = [1,1];
    if (patternFile) {
        pattern = fs.read(module.resolve('../patterns/' + patternFile));
    }


    var debug = function() {
        if (DEBUG == false) {
            return;
        }
        var args = Array.prototype.slice.call(arguments, 0);
        console.log.apply(console, ['[Client#' + offset + ']'].concat(args));
    }

    // fill our board with random values
    var randomizeBoard = function() {
        for (var i = 0; i < boardSizePerClient; i++) {
            board[i] = [];
            for (var j = 0; j < boardSizePerClient; j++) {
                if (pattern) {
                    board[i][j] = false;
                } else {
                    board[i][j] = Math.random() < 0.2 ? true : false
                }
            }
        }
        if (pattern) {
            pattern.split('\n').forEach(function(row, ridx) {
                row.split('').forEach(function(colVal, colidx) {
                    board[patternOffset[0]+colidx][patternOffset[1]+ridx] = colVal === 'O';
                });
            })
        }
        debug('Board filled!')
    }

    var relativeSignum = function(val) {
        return (val < 0) ? -1 :
            (val >= boardSizePerClient) ? 1 : 0;
    }
    var getAcrossNeighbours = function(cell) {
        var [col, row] = cell;
        if (col >= 0 && col < boardSizePerClient &&
                row >= 0 && row < boardSizePerClient) {
            return board[col][row]
        } else {
            // get from neighbour
            var tBoard = receivedBoards[step % 2];
            var colSig = relativeSignum(col);
            var rowSig = relativeSignum(row);
            if (tBoard[[colSig, rowSig]] === undefined) {
                return false;
            }
            var nCol = col - (colSig * boardSizePerClient);
            var nRow = row - (rowSig * boardSizePerClient);
            return tBoard[[colSig, rowSig]][nCol][nRow];
        }
    }

    var aliveNeighbourCount = function(col, row) {
        var alive = 0;
        [[-1, 0], [0, -1], [1, 0], [0, 1],
            [-1, -1], [1, 1], [-1, 1], [1, -1]].forEach(function(noffset) {
            var cell = [
                noffset[0] + col,
                noffset[1] + row
            ];
            if (getAcrossNeighbours(cell) === true) {
                alive++;
            }
        }, this);
        return alive;
    };

    var stepBoard = function() {
        var nextBoard = [];
        for (var i = 0; i < boardSizePerClient; i++) {
            nextBoard[i] = [];
            for (var j = 0; j< boardSizePerClient; j++) {
                var alive = aliveNeighbourCount(i, j);
                var currentState = board[i][j];
                var state = (alive == 3  || (currentState == true && alive == 2));
                nextBoard[i][j] = state;
            }
        }
        board = nextBoard;
    };

    var createReceivedBoards = function() {
        // 2 states
        for (var i = 0; i < 2; i ++) {
            receivedBoards[i] = [];
            receivedBoards[i].received = 0;
            receivedBoards[i].finished = false;
        }
    }

    var sendBoard = function() {
        var message = {
            step: step,
            offset: offset,
            board: board
        }
        debug('Sending step', step);
        if (board.length <= 0) {
          // @@ deal with this problem
        }
        connection.sendMessage(JSON.stringify(message));
    }

    var connection = null;

    var textMessageConnection = new JavaEventEmitter(org.eclipse.jetty.websocket.WebSocket.OnTextMessage);

    textMessageConnection.on('open', function(conn) {
        connection = conn;
        // request to be added to worker
        connection.sendMessage("work");
        debug('connected');
    });
    textMessageConnection.on('close', function(closeCode, message) {
        console.log('Connection lost (error msg: "' + message + '"): shutting down now.');
        require('system').exit(1);
    });
    textMessageConnection.on('message', function(message) {
        var msg = JSON.parse(message);
        if (msg.assignOffset !== undefined) {
            debug('Received my offset', offset);
            offset = msg.assignOffset;
        } else if (msg.neighbourCount !== undefined) {
            neighbourCount = msg.neighbourCount;
            boardSizePerClient = msg.boardSizePerClient;
            debug('Received neighbourCount: ', neighbourCount, 'and boardSizePerClient: ', boardSizePerClient);
            randomizeBoard();
            createReceivedBoards();
        } else if (msg.board) {
            // board updates
            var _step = msg.step;
            var _offset = msg.offset;
            // older steps should not appear
            if (_step < step) {
                throw new Error('unexpected step update, my step: ' + step + 'got step: ' + _step);
            }
            debug ('Received step', _step, ' from relative offset:', _offset)
            var targetBoard = receivedBoards[_step % 2];
            targetBoard[_offset] = msg.board;
            targetBoard.received++;
            if (targetBoard.received === neighbourCount) {
                targetBoard.finished = true;
                debug('Received all neighbours for step', step);
            } else if (targetBoard.received > neighbourCount) {
                throw new Error('Something went wrong! \
                    Received more neighbour msgs (' + targetBoard.received + ') \
                    then expected (' + neighbourCount + ')');
            }
        } else if (msg.run === true) {
            // send initial state
            sendBoard();
        } else {
            throw new Error('Unknown message received: ' + message);
        }
    });

    // if all neighbours arrived, we
    // can calculate the next step
    var tryStepBoard = function () {
        if (receivedBoards.length > 0 || neighbourCount === 0) {
            var cBoard = receivedBoards[step % 2];
            if (cBoard.finished == true || neighbourCount === 0) {
                cBoard.received = 0;
                stepBoard();
                step++;
                cBoard.finished = false;
                sendBoard();
            }
        }
        setTimeout(tryStepBoard, updateSpeed * 1000);
    }

    /**
        CONSTRUCTOR
     */
    websocketClient.open(
        new java.net.URI(websocketURL),
        textMessageConnection.impl,
        10, java.util.concurrent.TimeUnit.SECONDS
    );

    setTimeout(tryStepBoard, updateSpeed * 1000);
    return this;
};
