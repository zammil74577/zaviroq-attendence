import React, { useEffect, useState } from 'react';
import { getInitials } from '../utils/format';

export const Avatar: React.FC<{
  name: string;
  color: string;
  url?: string;
  className?: string;
}> = ({ name, color, url, className = 'h-9 w-9 text-xs' }) => {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [url]);

  if (url && !failed) {
    return (
      <img
        src={url}
        alt={name}
        onError={() => setFailed(true)}
        className={`rounded-full object-cover shrink-0 border border-white/60 shadow-xs ${className}`}
      />
    );
  }

  return (
    <span
      className={`rounded-full flex items-center justify-center font-bold text-white shrink-0 zv-text-white-keep ${className}`}
      style={{ backgroundColor: color || '#6D4AFF' }}
    >
      {getInitials(name)}
    </span>
  );
};
