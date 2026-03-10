import React from 'react';
import { PillIcon } from './icons/Icons';

const Header: React.FC = () => {
  return (
    <header className="text-center my-8">
      <div className="inline-flex items-center justify-center">
        <PillIcon className="w-12 h-12 text-sky-500" />
        <h1 className="text-4xl sm:text-5xl font-bold text-slate-800 ml-3">
          ChronaCare
        </h1>
      </div>
      <p className="text-slate-500 mt-2">Your AI-powered pill reminder.</p>
    </header>
  );
};

export default Header;