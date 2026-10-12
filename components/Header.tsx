import React from 'react';
import { PillIcon } from './icons/Icons';

const Header: React.FC = () => {
  return (
    <header className="my-4 sm:my-8 flex-shrink min-w-0">
      <div className="flex items-center">
        <PillIcon className="w-8 h-8 sm:w-12 sm:h-12 text-sky-500 flex-shrink-0" />
        <h1 className="text-2xl sm:text-4xl md:text-5xl font-bold text-slate-800 ml-2 sm:ml-3 truncate">
          ChronaCare
        </h1>
      </div>
      <p className="text-slate-500 mt-1 sm:mt-2 text-sm sm:text-base truncate">Your AI-powered pill reminder.</p>
    </header>
  );
};

export default Header;