const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');

// pmx_reduce_face 独立 demo 构建配置（development 模式）
// 通过 dev-server static 托管 demo/assets 下的 PMX + 纹理资源，demo 以 URL 形式引用
const PORT = 8096;

module.exports = {
    entry: './demo/main.ts',
    mode: 'development',
    devtool: 'eval-source-map',

    output: {
        path: path.resolve(__dirname, 'dist'),
        filename: 'static/js/[name].js',
        clean: true,
    },

    resolve: {
        extensions: ['.ts', '.tsx', '.js'],
        modules: ['node_modules'],
    },

    module: {
        rules: [
            {
                test: /\.tsx?$/,
                use: [
                    {
                        loader: 'ts-loader',
                        options: {
                            transpileOnly: true,
                        },
                    },
                ],
            },
        ],
    },

    plugins: [
        new HtmlWebpackPlugin({
            template: './demo/index.html',
            hash: true,
            filename: 'index.html',
            inject: true,
        }),
    ],

    devServer: {
        compress: true,
        port: PORT,
        open: true,
        headers: {
            'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
        },
        static: [
            // 托管 demo/assets（模型 + 纹理 + stats.json），publicPath 为 /assets
            {
                directory: path.resolve(__dirname, 'demo/assets'),
                publicPath: '/assets',
                watch: false,
            },
        ],
    },
};
