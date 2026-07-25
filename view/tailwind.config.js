/** @type {import('tailwindcss').Config} */
export default {
    content: [
        './index.html',
        './src/**/*.{js,ts,jsx,tsx}',
    ],
    theme: {
        extend: {
            colors: {
                accent: '#5a7fe4',
                'accent-light': '#7c9be9',
                'accent-dark': '#496fce',
                surface: '#f7f9fc',
                'surface-elevated': '#ffffff',
                'text-primary': '#2f3b4f',
                'text-secondary': '#7c879a',
                'text-tertiary': '#adb6c5',
                ok: '#4b9a83',
                ng: '#dc8992',
                warn: '#c9a06a',
            },
            fontFamily: {
                sans: ['-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', '"PingFang SC"', '"Microsoft YaHei"', '"Noto Sans SC"', 'sans-serif'],
            },
            boxShadow: {
                card: '0 8px 24px rgba(31, 48, 84, 0.045), 0 1px 4px rgba(31, 48, 84, 0.035)',
                'card-hover': '0 14px 30px rgba(31, 48, 84, 0.075), 0 3px 10px rgba(31, 48, 84, 0.045)',
                modal: '0 18px 48px rgba(29, 45, 78, 0.11)',
            },
        },
    },
    plugins: [],
};

