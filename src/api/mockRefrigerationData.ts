import { useState, useEffect } from 'react';

export interface RefrigerationNode {
  id: string;
  name: string;
  mac: string;
  temperature: number;
  doorOpen: boolean;
  online: boolean;
}

export interface RefrigerationHistory {
  date: string;
  temperature: number;
  door_status: number;
}

// Generate an extended date array mimicking the image chart (1 month)
function generateHistoryData(baseTemp: number, isAnomaly: boolean): RefrigerationHistory[] {
  const data: RefrigerationHistory[] = [];
  let currentTemp = baseTemp;
  
  // Create 30 days of data, 4 data points per day (every 6 hours)
  const now = new Date();
  for (let i = 120; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 6 * 60 * 60 * 1000);
    // Mimic the compressor zig-zag (rising and falling)
    currentTemp = isAnomaly 
      ? baseTemp + Math.random() * 3 + (i % 2 === 0 ? 1.5 : -0.5) // Anomalies run hotter
      : baseTemp + (i % 2 === 0 ? 2 : -2) + (Math.random() - 0.5); // Normal cycling

    // Random door opens (rare unless node is anomaly type with stuck door)
    const doorOpen = isAnomaly && Math.random() > 0.8 ? 1 : (Math.random() > 0.95 ? 1 : 0);

    data.push({
      date: d.toISOString().substring(0, 16).replace('T', ' '),
      temperature: Number(currentTemp.toFixed(1)),
      door_status: doorOpen,
    });
  }
  return data;
}

const MOCK_NODES: RefrigerationNode[] = [
  { id: '1', name: 'Node #1', mac: '00:1A:2B:3C:4D:01', temperature: 4.1, doorOpen: false, online: true },
  { id: '2', name: 'Node #2', mac: '00:1A:2B:3C:4D:02', temperature: 5.1, doorOpen: false, online: true },
  { id: '3', name: 'Node #3', mac: '00:1A:2B:3C:4D:03', temperature: 4.3, doorOpen: false, online: true },
  { id: '4', name: 'Node #4', mac: '00:1A:2B:3C:4D:04', temperature: 6.7, doorOpen: false, online: true },
  { id: '5', name: 'Node #5', mac: '00:1A:2B:3C:4D:05', temperature: 2.9, doorOpen: false, online: true },
  { id: '6', name: 'Node #6', mac: '00:1A:2B:3C:4D:06', temperature: 6.1, doorOpen: false, online: true },
  { id: '7', name: 'Node #7', mac: '00:1A:2B:3C:4D:07', temperature: 10.6, doorOpen: false, online: true },
  { id: '8', name: 'Node #8', mac: '00:1A:2B:3C:4D:08', temperature: 3.9, doorOpen: false, online: true },
  { id: '9', name: 'Node #9', mac: '00:1A:2B:3C:4D:09', temperature: 3.1, doorOpen: false, online: true },
  { id: '10', name: 'Node #10', mac: '00:1A:2B:3C:4D:0A', temperature: 6.9, doorOpen: true, online: true },
  { id: '11', name: 'Node #11', mac: '00:1A:2B:3C:4D:0B', temperature: 6.5, doorOpen: false, online: true },
  { id: '12', name: 'Node #12', mac: '00:1A:2B:3C:4D:0C', temperature: 4.4, doorOpen: false, online: true },
];

// Pre-generate detailed history for each node using useMemo pattern normally
const MOCK_HISTORY = MOCK_NODES.reduce((acc, node) => {
  const isAnomaly = node.temperature > 6 || node.doorOpen;
  acc[node.id] = generateHistoryData(isAnomaly ? 6.5 : 3.5, isAnomaly);
  return acc;
}, {} as Record<string, RefrigerationHistory[]>);

export function useRefrigerationData() {
  const [nodes, setNodes] = useState<RefrigerationNode[]>(MOCK_NODES);
  
  // Simulate live real-time updates every 5 seconds (compressor fluctuations)
  useEffect(() => {
    const interval = setInterval(() => {
      setNodes(current => 
        current.map(node => {
          // Normal nodes fluctuate small amounts. High temp nodes fluctuate more.
          const variance = (Math.random() - 0.5) * (node.temperature > 6 ? 0.8 : 0.4);
          let newTemp = node.temperature + variance;
          if (newTemp < -40) newTemp = -40; // hardware limit
          return { ...node, temperature: Number(newTemp.toFixed(1)) };
        })
      );
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  return { 
    nodes, 
    threshold: 6, // Global default threshold matching the image
    getHistory: (nodeId: string) => MOCK_HISTORY[nodeId] || []
  };
}
