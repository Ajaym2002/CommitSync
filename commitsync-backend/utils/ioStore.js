/**
 * Shared Socket.IO instance store.
 * Modules can require this to access the io instance without
 * creating circular dependencies with server.js.
 */
let _io = null;

module.exports = {
  setIO(io) { _io = io; },
  getIO() { return _io; }
};
