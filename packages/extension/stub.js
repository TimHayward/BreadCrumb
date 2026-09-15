window.copied = [];
Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t) => { window.copied.push(t); } } });
