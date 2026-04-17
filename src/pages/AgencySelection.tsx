import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useKeycloak } from '../auth/MockKeycloak';
import { Building2, ArrowRight } from 'lucide-react';

const agencies = [
  { id: '1', name: 'กรมป่าไม้ (Royal Forest Department)', code: 'rfd' },
  { id: '2', name: 'องค์การบริหารจัดการก๊าซเรือนกระจก (TGO)', code: 'tgo' },
  { id: '3', name: 'กรมอุทยานแห่งชาติ (DNP)', code: 'dnp' },
];

const AgencySelection = () => {
  const navigate = useNavigate();
  const { keycloak } = useKeycloak();

  const handleSelect = (code: string) => {
    // DEMO BYPASS: Navigate directly to dashboard
    console.log('Selected agency (Demo Mode):', code);
    navigate('/dashboard');
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
      <div className="max-w-4xl w-full">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">Carbon Credit IoT Platform</h1>
          <p className="text-lg text-gray-600">Please select your agency to proceed</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {agencies.map((agency) => (
            <button
              key={agency.id}
              onClick={() => handleSelect(agency.code)}
              className="group glass card flex flex-col items-center text-center hover:bg-brand-50 transition-all duration-300"
            >
              <div className="w-16 h-16 bg-brand-100 rounded-full flex items-center justify-center mb-4 group-hover:bg-brand-200 transition-colors">
                <Building2 className="w-8 h-8 text-brand-600" />
              </div>
              <h3 className="font-semibold text-gray-900 mb-2">{agency.name}</h3>
              <p className="text-sm text-gray-500 mb-4 uppercase tracking-wider">{agency.code}</p>
              <div className="mt-auto flex items-center text-brand-600 font-medium">
                Enter <ArrowRight className="ml-2 w-4 h-4 transform group-hover:translate-x-1 transition-transform" />
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default AgencySelection;
