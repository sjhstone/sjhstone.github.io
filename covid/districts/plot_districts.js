const AXIS_ICON_PATH = 'path://M256 459.968v286.976l2.56 3.648 237.76 132.096v-281.536L256 459.968z m10.496-30.976l245.824 144.448 245.216-144.416-243.392-135.232h-4.288l-243.36 135.2zM768 460l-239.68 141.12v281.216l237.12-131.744 2.56-3.648v-286.944zM224 743.68V416l272-151.104V94.816h32v170.08L800 416v327.68l166.272 116.544-18.368 26.208-159.648-111.904L512 928l-276.256-153.472-159.68 111.904-18.336-26.24L224 743.68z'

let cities = {
    pudong: [],
    huangpu: [],
    jingan: [],
    xuhui: [],
    changning: [],
    putuo: [],
    hongkou: [],
    yangpu: [],
    baoshan: [],
    minhang: [],
    jiading: [],
    jinshan: [],
    songjiang: [],
    qingpu: [],
    fengxian: [],
    chongming: [],
};

const default_shown_city = {pudong: true};

let citynames = {
    pudong: '浦东',
    huangpu: '黄浦',
    jingan: '静安',
    xuhui: '徐汇',
    changning: '长宁',
    putuo: '普陀',
    hongkou: '虹口',
    yangpu: '杨浦',
    baoshan: '宝山',
    minhang: '闵行',
    jiading: '嘉定',
    jinshan: '金山',
    songjiang: '松江',
    qingpu: '青浦',
    fengxian: '奉贤',
    chongming: '崇明',
};

const dailyVsAccumChart = echarts.init(
    document.getElementById('main'), 
    null,
    {
        renderer: 'svg',
    }
);

window.onresize = function(){
    dailyVsAccumChart.resize()
}

let option = {
    labelLayout: {
        moveOverlap: 'shiftY'
    },
    grid: {
        left: 25,
        right: 0,
        top: 0,
        bottom: 25,
    },
    dataZoom: [
        {
            type: 'inside',
            filterMode: 'none'
        },
        {
            type: 'inside',
            orient: 'vertical',
            filterMode: 'none'
        },
    ],
    legend: {
        data: [],
        selected: {},
        top: 12,
        left: 40,
        orient: 'vertical',
    },
    toolbox: {
        feature: {
            dataZoom: {},
            dataView: {title: '原始数据表'},
            saveAsImage: {title: '导出图片'},
            myAxisScale: {
                show: true,
                title: '线性/对数坐标切换',
                icon: AXIS_ICON_PATH,
                onclick: function (){
                    let opt = dailyVsAccumChart.getOption();
                    dailyVsAccumChart.setOption({
                        xAxis: {
                            type: opt.xAxis[0].type === 'log' ? 'value' : 'log',
                            name: '累计',
                            minorSplitLine: {
                                show: true
                            }
                        },
                        yAxis: {
                            type: opt.yAxis[0].type === 'log' ? 'value' : 'log',
                            name: '日增',
                            minorSplitLine: {
                                show: true
                            }
                        }
                    })
                }
            },
        }
    },
    tooltip: {
        trigger: 'item',
    },
    xAxis: {
        type: 'log',
        name: '累计',
        nameLocation: 'center',
        nameGap: -20,
        minorSplitLine: {
            show: true
        },
        min: 100,
        max: 350000,
    },
    yAxis: {
        type: 'log',
        name: '日增',
        nameLocation: 'center',
        nameGap: -20,
        axisLabel: {
            rotate: 90,
        },
        minorSplitLine: {
            show: true
        },
        min: 1,
        max: 50000,
    },
    series: [],
    dataset: []
}

dailyVsAccumChart.showLoading('default', {text: '数据加载中'});

Papa.parse(`shanghai_by_district.csv?t=${(new Date()).getTime()}`, {
    download: true,
    skipEmptyLines: true,
    dynamicTyping: true,
    complete: function(results) {
        let raw_data = results.data.map(
            x => x.map(
                y => y === 0 ? null : y
            )
        );

        option.dataset.push({
            id: 'main',
            dimensions: ['天数','日期','浦东','黄浦','静安','徐汇','长宁','普陀','虹口','杨浦','宝山','闵行','嘉定','金山','松江','青浦','奉贤','崇明','浦东_累计','浦东_7日平均','黄浦_累计','黄浦_7日平均','静安_累计','静安_7日平均','徐汇_累计','徐汇_7日平均','长宁_累计','长宁_7日平均','普陀_累计','普陀_7日平均','虹口_累计','虹口_7日平均','杨浦_累计','杨浦_7日平均','宝山_累计','宝山_7日平均','闵行_累计','闵行_7日平均','嘉定_累计','嘉定_7日平均','金山_累计','金山_7日平均','松江_累计','松江_7日平均','青浦_累计','青浦_7日平均','奉贤_累计','奉贤_7日平均','崇明_累计','崇明_7日平均'],
            source: raw_data,
        });

        let i = 0;
        for (const city in cities) {
            option.series.push({
                type: 'line', name: citynames[city], datasetId: 'main',
                encode: {x: `${citynames[city]}_累计`, y: `${citynames[city]}_7日平均`, tooltip:[0,1,i+2,18+2*i,19+2*i]},
                emphasis: {focus: 'series'},
                endLabel:{
                    show: true,
                    formatter: '{a}',
                    color: 'inherit',
                },
            });
            option.series.push({
                type: 'scatter', name: citynames[city], datasetId: 'main',
                encode: {x: `${citynames[city]}_累计`, y: `${citynames[city]}`, tooltip:[0,1,i+2]},
                emphasis: {focus: 'series'},
                markPoint: {
                    symbol: 'pin',
                    symbolSize: 65,
                    label: {
                        formatter: '{b}',
                    },
                    data: [
                        {
                            name: `${citynames[city]}\n峰值`,
                            type: 'max',
                        }
                    ]
                }
            });
            option.legend.data.push(citynames[city])
            option.legend.selected[citynames[city]] = city in default_shown_city;
            i += 1;
        }
        let max_ndays = raw_data.slice(-1)[0][0];
        slider2now.max = max_ndays;
        slider2now.setAttribute('max', max_ndays);
        slider2now.value = max_ndays;
        slider2now.setAttribute('value', max_ndays);
        sinceFirstOmicron.innerText = `${max_ndays}`;
        dailyVsAccumChart.hideLoading();
        dailyVsAccumChart.setOption(option);
    }
});

function sameDuration(x) {
    dailyVsAccumChart.showLoading('default', {text: '数据处理中'});
    option = dailyVsAccumChart.getOption();

    option.dataset = [];
    option.series = [];

    option.dataset.push({
        id: 'trimmed',
        fromDatasetId: 'main',
        transform: {
            type: 'filter',
            config: {
                dimension: '天数',
                '<=': x,
            }
        }
    });
    let i = 0;
    for (const city in cities) {
        option.series.push({
            type: 'line', name: citynames[city], datasetId: 'trimmed',
            encode: {x: `${citynames[city]}_累计`, y: `${citynames[city]}_7日平均`, tooltip:[0,1,i+2,18+2*i,19+2*i]},
            emphasis: {focus: 'series'},
        });
        option.series.push({
            type: 'scatter', name: citynames[city], datasetId: 'trimmed',
            encode: {x: `${citynames[city]}_累计`, y: `${citynames[city]}`, tooltip:[0,1,i+2]},
            emphasis: {focus: 'series'},
        });
        i += 1;
    }
    dailyVsAccumChart.hideLoading();
    dailyVsAccumChart.setOption(option);
}
