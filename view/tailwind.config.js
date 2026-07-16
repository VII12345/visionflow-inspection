/** @type {import('tailwindcss').Config} */
export default {
    content: [
        './index.html',
        './src/**/*.{js,ts,jsx,tsx}',
    ],
    theme: {
        extend: {
            colors: {
                accent: '#5b6ef5',
                'accent-light': '#7b8cf8',
                'accent-dark': '#4a5bd4',
                'bg-root': '#090c12',
                'bg-layer1': '#111620',
                'bg-layer2': '#171d2b',
                'bg-layer3': '#1e2534',
                'bg-elevated': '#252d3d',
            },
            fontFamily: {
                sans: ['-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', '"PingFang SC"', '"Microsoft YaHei"', '"Noto Sans SC"', 'sans-serif'],
            },
        },
    },
    plugins: [],
};
