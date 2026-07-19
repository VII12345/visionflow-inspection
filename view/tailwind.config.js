/** @type {import('tailwindcss').Config} */
export default {
    content: [
        './index.html',
        './src/**/*.{js,ts,jsx,tsx}',
    ],
    theme: {
        extend: {
            colors: {
                // Swiss minimalist palette — single blue accent, monochrome base
                accent: '#2563eb',
                'accent-light': '#3b82f6',
                'accent-dark': '#1d4ed8',
                // Surfaces
                'surface': '#f8f9fa',
                'surface-elevated': '#ffffff',
                // Text
                'text-primary': '#111827',
                'text-secondary': '#6b7280',
                'text-tertiary': '#9ca3af',
                // Status (minimal — only what's needed)
                'ok': '#059669',
                'ng': '#dc2626',
                'warn': '#d97706',
            },
            fontFamily: {
                sans: ['-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', '"PingFang SC"', '"Microsoft YaHei"', '"Noto Sans SC"', 'sans-serif'],
            },
            boxShadow: {
                'card': '0 1px 3px 0 rgba(0,0,0,0.06), 0 1px 2px -1px rgba(0,0,0,0.06)',
                'card-hover': '0 4px 6px -1px rgba(0,0,0,0.07), 0 2px 4px -2px rgba(0,0,0,0.05)',
                'modal': '0 20px 60px -12px rgba(0,0,0,0.15)',
            },
        },
    },
    plugins: [],
};
