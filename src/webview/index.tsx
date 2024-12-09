import React from 'react';
import { createRoot } from 'react-dom/client';
import { ChatPanel } from './ChatPanel';

const container = document.getElementById('root');
if (container) {
    const root = createRoot(container);
    root.render(
        <ChatPanel />
    );
}
