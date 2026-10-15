import React from 'react';
import {createRoot} from 'react-dom/client';
import LibraryApp from '../components/LibraryApp';
import '../app/paperleaf.css';
createRoot(document.getElementById('root')!).render(<LibraryApp mode="local"/>);
