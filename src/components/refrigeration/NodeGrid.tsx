import React from 'react';
import { RefrigerationNode } from '../../api/mockRefrigerationData';
import NodeCard from './NodeCard';

interface Props {
  nodes: RefrigerationNode[];
  threshold: number;
  onSelectNode: (id: string) => void;
}

export default function NodeGrid({ nodes, threshold, onSelectNode }: Props) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
      {nodes.map(node => (
        <NodeCard 
          key={node.id} 
          node={node} 
          threshold={threshold} 
          onClick={onSelectNode} 
        />
      ))}
    </div>
  );
}
