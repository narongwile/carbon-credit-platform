import Keycloak from 'keycloak-js';

// Setup Keycloak instance as needed
// Pass initialization options as required or leave blank to load from keycloak.json
const keycloak = new Keycloak({
  url: import.meta.env.VITE_KEYCLOAK_URL || 'http://localhost:8080',
  realm: 'master', // Default realm, will be dynamic per agency in production
  clientId: 'carbon-credit-web',
});

export default keycloak;
