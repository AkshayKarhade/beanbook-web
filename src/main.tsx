import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './index.css';
import App from './App.tsx';
import { installButtonFeedback } from './buttonFeedback';

installButtonFeedback();

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter basename="/beanbook">
      <App />
    </BrowserRouter>
  </React.StrictMode>
);