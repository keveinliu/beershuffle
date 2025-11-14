const config = {
  projectName: 'beershuffle-taro',
  date: '2025-11-13',
  designWidth: 750,
  deviceRatio: {
    640: 2.34 / 2,
    750: 1,
    828: 1.81 / 2
  },
  sourceRoot: 'src',
  outputRoot: 'dist',
  framework: 'react',
  compiler: 'webpack5',
  mini: {
    postcss: {
      pxtransform: {
        enable: true,
        config: {}
      },
      url: {
        enable: true,
        config: {
          limit: 10240
        }
      },
      cssModules: {
        enable: false,
        config: {}
      }
    }
  }
  ,
  defineConstants: {
    'process.env.TARO_API_BASE': JSON.stringify(process.env.TARO_API_BASE || '')
  }
}

module.exports = function () {
  return config
}
