import React, { useState } from 'react';
import Layout from '../components/Layout';
import { MapContainer, TileLayer, Marker, Popup, ZoomControl } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { Icon, divIcon } from 'leaflet';

// Fix leaflet icon paths
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

delete (Icon.Default.prototype as any)._getIconUrl;
Icon.Default.mergeOptions({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
});

const mockSensors = [
  { id: 1, name: 'Node #1 (Bangkok HQ)', lat: 13.7563, lng: 100.5018, status: 'critical', temp: '5.2°C', co2: '450ppm', lastUpdated: 'Just now' },
  { id: 2, name: 'Node #2 (Chiang Mai)', lat: 18.7883, lng: 98.9853, status: 'warning', temp: '2.5°C', co2: '500ppm', lastUpdated: '5 mins ago' },
  { id: 3, name: 'Node #3 (Phuket)', lat: 7.8804, lng: 98.3923, status: 'healthy', temp: '1.2°C', co2: '410ppm', lastUpdated: '2 mins ago' },
  { id: 4, name: 'Node #4 (Khon Kaen)', lat: 16.4322, lng: 102.8236, status: 'healthy', temp: '-18°C', co2: '405ppm', lastUpdated: '10 mins ago' },
  { id: 5, name: 'Node #5 (Pattaya)', lat: 12.9236, lng: 100.8825, status: 'healthy', temp: '-20°C', co2: '415ppm', lastUpdated: '1 min ago' },
];

const createCustomIcon = (status: string) => {
  const color = status === 'critical' ? 'bg-red-500 shadow-red-500' : status === 'warning' ? 'bg-amber-500 shadow-amber-500' : 'bg-emerald-500 shadow-emerald-500';
  const pulseColor = status === 'critical' ? 'bg-red-500' : status === 'warning' ? 'bg-amber-500' : 'bg-emerald-500';
  
  return divIcon({
    className: 'custom-leaflet-marker',
    html: `
      <div class="relative flex items-center justify-center w-6 h-6">
        <div class="absolute inline-flex w-full h-full rounded-full opacity-50 animate-ping ${pulseColor}"></div>
        <div class="relative inline-flex w-4 h-4 rounded-full border-2 border-white shadow-lg ${color}"></div>
      </div>
    `,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -12],
  });
};

export default function LiveMap() {
  return (
    <Layout>
      <div className="flex flex-col h-[calc(100vh-140px)]">
        <div className="mb-4 flex justify-between items-end">
          <div>
            <h1 className="text-2xl font-extrabold text-gray-900 dark:text-white">Live Sensor Map</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 font-medium">Real-time geographical distribution of all active sensors.</p>
          </div>
          <div className="flex space-x-4 text-xs font-bold bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 p-2 rounded-lg shadow-sm">
            <div className="flex items-center"><div className="w-3 h-3 bg-emerald-500 rounded-full mr-2"></div> Healthy</div>
            <div className="flex items-center"><div className="w-3 h-3 bg-amber-500 rounded-full mr-2"></div> Warning</div>
            <div className="flex items-center"><div className="w-3 h-3 bg-red-500 rounded-full mr-2"></div> Critical</div>
          </div>
        </div>

        <div className="flex-1 rounded-2xl overflow-hidden border border-gray-200 dark:border-gray-800 shadow-sm relative z-0">
          <MapContainer 
            center={[13.736717, 100.523186]} 
            zoom={6} 
            className="w-full h-full"
            zoomControl={false}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
            />
            <ZoomControl position="bottomright" />
            
            {mockSensors.map(sensor => (
              <Marker 
                key={sensor.id} 
                position={[sensor.lat, sensor.lng]}
                icon={createCustomIcon(sensor.status)}
              >
                <Popup className="custom-popup rounded-xl overflow-hidden">
                  <div className="p-1 min-w-[200px]">
                    <h3 className="font-bold text-gray-900 text-sm border-b border-gray-100 pb-2 mb-2">{sensor.name}</h3>
                    <div className="grid grid-cols-2 gap-2 text-xs mb-2">
                      <div>
                        <span className="text-gray-500 block">Temperature</span>
                        <span className={`font-bold ${sensor.status === 'critical' ? 'text-red-600' : 'text-gray-900'}`}>{sensor.temp}</span>
                      </div>
                      <div>
                        <span className="text-gray-500 block">CO2 Level</span>
                        <span className="font-bold text-gray-900">{sensor.co2}</span>
                      </div>
                    </div>
                    <div className="text-[10px] text-gray-400 font-medium">Updated: {sensor.lastUpdated}</div>
                  </div>
                </Popup>
              </Marker>
            ))}
          </MapContainer>
        </div>
      </div>
    </Layout>
  );
}
