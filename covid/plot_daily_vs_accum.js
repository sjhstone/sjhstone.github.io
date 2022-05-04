const AXIS_ICON_PATH = 'path://M256 459.968v286.976l2.56 3.648 237.76 132.096v-281.536L256 459.968z m10.496-30.976l245.824 144.448 245.216-144.416-243.392-135.232h-4.288l-243.36 135.2zM768 460l-239.68 141.12v281.216l237.12-131.744 2.56-3.648v-286.944zM224 743.68V416l272-151.104V94.816h32v170.08L800 416v327.68l166.272 116.544-18.368 26.208-159.648-111.904L512 928l-276.256-153.472-159.68 111.904-18.336-26.24L224 743.68z'


let cities = {
    seoul: [],
    osaka: [],
    tokyo: [],
    hongkong: [],
    shanghai: [],
    beijing: [],
};
const default_shown_city = {shanghai: true, hongkong: true};

let citynames = {
    seoul: '首尔',
    osaka: '大阪',
    tokyo: '东京',
    hongkong: '香港',
    shanghai: '上海',
    beijing: '北京',
};

let citycolors = {
    seoul: '#2A87D1',
    osaka: '#000099',
    tokyo: '#199332',
    hongkong: '#A0148E',//'#E20613',
    shanghai: '#FB9606',
    beijing: '#E60000',
}

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
    grid: {
        left: 25,
        right: 0,
        top: 0,
        bottom: 25,
    },
    dataZoom: [
        {
            type: 'inside',
        },
        {
            type: 'inside',
            orient: 'vertical'
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
        }
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
        }
    },
    series: [],
    dataset: []
}

dailyVsAccumChart.showLoading('default', {text: '数据加载中'});
for (const city in cities) {
    Papa.parse(`data/${city}.csv?t=${(new Date()).getTime()}`, {
        download: true,
        dynamicTyping: true,
        skipEmptyLines: true,
        complete: function(results) {
            cities[city] = results.data;

            option.dataset.push({
                id: city,
                dimensions: ['天数','日期','累计','日增','近7日平均日增','累计占总人口'],
                source: cities[city],
            });
            option.series.push({
                type: 'line', name: citynames[city], datasetId: city,
                encode: {x: '累计', y: '近7日平均日增', tooltip:[0,1,2,3,4,5]},
                emphasis: {focus: 'series'},
                itemStyle: {color: citycolors[city], borderWidth: 0, borderCap: 'round'},
                lineStyle: {color: citycolors[city]},
            });
            option.series.push({
                type: 'scatter', name: citynames[city], datasetId: city,
                encode: {x: '累计', y: '日增', tooltip:[0,1,3]},
                itemStyle: {color: citycolors[city], borderWidth: 0, borderCap: 'round'}
            });
            option.legend.data.push(citynames[city])
            option.legend.selected[citynames[city]] = city in default_shown_city;
            option.legend.data.push(`${citynames[city]}当日原始`)
            option.legend.selected[`${citynames[city]}当日原始`] = false;

            let npastdays = results.data.slice(-1)[0][0];
            let tickopt = document.createElement('option');
            tickopt.setAttribute('id', `${citynames[city]}-tick`);
            tickopt.setAttribute('value', npastdays);
            slidertick.appendChild(tickopt)
            slider.setAttribute('list', 'tickmarks');
            if (npastdays > slider.max) {
                slider.max = npastdays;
                slider.setAttribute('max', npastdays);
                slider.value = npastdays;
                slider.setAttribute('value', npastdays);
                slider.removeAttribute('disabled');
                sinceFirstOmicron.innerText = `${npastdays}`;
            }

            dailyVsAccumChart.hideLoading();
            dailyVsAccumChart.setOption(option);
        }
    });
}

function sameDuration(x) {
    dailyVsAccumChart.showLoading('default', {text: '数据处理中'});
    option = dailyVsAccumChart.getOption();

    option.dataset = [];
    option.series = [];

    for (const city in cities) {
        option.dataset.push({
            id: `${city}_trimmed`,
            fromDatasetId: city,
            transform: {
                type: 'filter',
                config: {
                    dimension: '天数',
                    parser: 'date',
                    '<=': x,
                }
            }
        });

        option.series.push({
            type: 'line', name: citynames[city], datasetId: `${city}_trimmed`,
            encode: {x: '累计', y: '近7日平均日增', tooltip:[0,1,2,3,4,5]},
            emphasis: {focus: 'series'},
            itemStyle: {color: citycolors[city]},
            lineStyle: {color: citycolors[city]},
        });

        option.series.push({
            type: 'scatter', name: citynames[city], datasetId: `${city}_trimmed`,
            encode: {x: '累计', y: '日增', tooltip:[0,1,3]},
            emphasis: {focus: 'series'},
            itemStyle: {color: citycolors[city]},
            lineStyle: {color: citycolors[city]},
        });
    }
    dailyVsAccumChart.hideLoading();
    dailyVsAccumChart.setOption(option);
}


