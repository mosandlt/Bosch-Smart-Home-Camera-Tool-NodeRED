// bosch-camera-event.js
// Input node: polls or subscribes to Bosch SHC camera events.
// On event, emits: msg.payload = { cam: string, event_type: string, timestamp: string }
//
// Phase 2 TODO:
//   - Implement long-poll against SHC /smarthome/events (SSE endpoint)
//   - Filter by camera device ID (config.cameraId)
//   - Map SHC event types: MOTION_DETECTED, ALARM, PERSON_DETECTED, AUDIO_ALARM
//   - Use config node token for Authorization header
//   - Reconnect with exponential backoff on connection drop
//   - Optionally subscribe to FCM push (Google Firebase) for cloud path

module.exports = function (RED) {
    function BoschCameraEventNode(config) {
        RED.nodes.createNode(this, config);

        const node = this;

        // Reference to the config node holding SHC credentials
        this.server   = RED.nodes.getNode(config.server);
        this.cameraId = config.cameraId;  // SHC device ID, e.g. hdm:Cameras:EF791764-...
        this.eventTypes = config.eventTypes || ['MOTION_DETECTED', 'ALARM', 'PERSON_DETECTED'];

        if (!this.server) {
            node.status({ fill: 'red', shape: 'ring', text: 'no config' });
            node.error('No Bosch SHC config node selected');
            return;
        }

        node.status({ fill: 'grey', shape: 'ring', text: 'Phase 2: not connected' });

        // Phase 2: start long-poll / SSE subscription here
        // Example outgoing message shape (for downstream nodes / documentation):
        // node.send({
        //     topic: 'bosch/camera/event',
        //     payload: {
        //         cam:        '<camera device ID>',
        //         event_type: 'MOTION_DETECTED',
        //         timestamp:  new Date().toISOString(),
        //         raw:        { /* full SHC event object */ }
        //     }
        // });

        this.on('close', function (removed, done) {
            // Phase 2: cancel long-poll / SSE subscription
            node.status({});
            done();
        });
    }

    RED.nodes.registerType('bosch-camera-event', BoschCameraEventNode);
};
