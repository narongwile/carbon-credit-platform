import React, { createContext, useContext, useState, useEffect } from 'react';

type Role = 'admin' | 'user';

interface KeycloakContextType {
  keycloak: {
    authenticated: boolean;
    token: string;
    tokenParsed: {
      preferred_username: string;
      realm_access: { roles: string[] };
    };
    login: (role: Role) => void;
    logout: () => void;
  };
  initialized: boolean;
}

const MockKeycloakContext = createContext<KeycloakContextType | null>(null);

export const useKeycloak = () => {
  const context = useContext(MockKeycloakContext);
  if (!context) throw new Error('useKeycloak must be used within MockKeycloakProvider');
  return context;
};

export const MockKeycloakProvider = ({ children }: { children: React.ReactNode }) => {
  const [initialized, setInitialized] = useState(false);
  const [role, setRole] = useState<Role | null>(null);

  useEffect(() => {
    const savedRole = localStorage.getItem('mock_role') as Role | null;
    if (savedRole) {
      setRole(savedRole);
    }
    setInitialized(true);
  }, []);

  const login = (newRole: Role) => {
    setRole(newRole);
    localStorage.setItem('mock_role', newRole);
  };

  const logout = () => {
    setRole(null);
    localStorage.removeItem('mock_role');
  };

  const mockKeycloak = {
    authenticated: role !== null,
    token: role ? `mock-${role}-token` : '',
    tokenParsed: {
      preferred_username: role === 'admin' ? 'admin_user' : 'standard_user',
      realm_access: { roles: role ? [role] : [] }
    },
    login,
    logout
  };

  if (!initialized) return null; // wait for init

  return (
    <MockKeycloakContext.Provider value={{ keycloak: mockKeycloak, initialized: true }}>
      {children}
    </MockKeycloakContext.Provider>
  );
};
