import React, { createContext, useContext } from 'react';

const mockKeycloak = {
  authenticated: true,
  token: 'mock-demo-token',
  tokenParsed: {
    preferred_username: 'demo_admin',
    realm_access: { roles: ['admin'] }
  },
  login: () => { window.location.hash = '#/dashboard'; },
  logout: () => { window.location.hash = '#/'; }
};

const MockKeycloakContext = createContext({
  keycloak: mockKeycloak,
  initialized: true
});

export const useKeycloak = () => useContext(MockKeycloakContext);

export const MockKeycloakProvider = ({ children }: { children: React.ReactNode }) => {
  return (
    <MockKeycloakContext.Provider value={{ keycloak: mockKeycloak, initialized: true }}>
      {children}
    </MockKeycloakContext.Provider>
  );
};
