import React from 'react';
import { motion } from 'framer-motion';
import Aperture from './Aperture';

const CinematicLoader: React.FC<{ label?: string }> = ({ label = 'Zpracovávám' }) => {
  return (
    <div className="flex flex-col items-center justify-center">
      <div className="relative w-24 h-24 flex items-center justify-center">
        <motion.div
          className="absolute inset-0 rounded-full border border-border-subtle"
          animate={{ rotate: 360 }}
          transition={{ duration: 8, repeat: Infinity, ease: 'linear' }}
        />
        <Aperture className="w-14 h-14" spinning />
      </div>
      <div className="mt-4 text-xs font-black uppercase tracking-widest text-text-secondary">{label}</div>
    </div>
  );
};

export default CinematicLoader;
