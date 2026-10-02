import React from 'react';
import { createRoot } from 'react-dom/client';
import DemoRoot from './DemoRoot.jsx';
import './styles.css';
import './tauge.css';
import './meeting-views.css';
import './login.css';
import './responsive.css';

createRoot(document.getElementById('root')).render(<React.StrictMode><DemoRoot /></React.StrictMode>);
