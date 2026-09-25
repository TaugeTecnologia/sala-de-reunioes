import React from 'react';
import { createRoot } from 'react-dom/client';
import Root from './Root.jsx';
import './styles.css';
import './tauge.css';
import './meeting-views.css';
import './login.css';

createRoot(document.getElementById('root')).render(<React.StrictMode><Root /></React.StrictMode>);
