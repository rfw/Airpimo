import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import './styles/airpimo-home.css';
import './styles/airpimo-dialogs.css';
import './styles/airpimo-settings-tabs.css';
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
