'use strict'
// The browser talks directly to the catalogue using the user's Signal K session.
module.exports = app => ({
  id: 'signalk-forecast-dataset-browser',
  name: 'Forecast Dataset Browser',
  description: 'Browse forecast datasets, their metadata and original assets.',
  schema: { type: 'object', properties: {} },
  start() { app.setPluginStatus('Webapp available — uses your Signal K session') },
  stop() {}
})
