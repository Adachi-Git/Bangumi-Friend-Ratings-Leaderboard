// ==UserScript==
// @name         Bangumi.tv Friend Ratings Leaderboard
// @namespace    https://github.com/Adachi-Git
// @version      0.2
// @description  Friend Ratings Leaderboard
// @author       Adachi
// @match        https://bangumi.tv/user/*/friends
// @match        https://bgm.tv/user/*/friends
// @match        https://chii.in/user/*/friends
// @license MIT
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // 首次运行时创建 IndexedDB 数据库和对象存储区
    function initializeIndexedDB() {
        // 打开或创建名为 'friendRatingsDB' 的数据库
        const dbPromise = indexedDB.open('friendRatingsDB', 1);

        // 在数据库版本变化时创建或更新对象存储区
        dbPromise.onupgradeneeded = function(event) {
            const db = event.target.result;
            // 如果不存在名为 'friendRatingsStore' 的对象存储区，则创建它
            if (!db.objectStoreNames.contains('friendRatingsStore')) {
                db.createObjectStore('friendRatingsStore', { keyPath: 'subject_id' });
            }
        };

        // 处理数据库打开成功的情况
        dbPromise.onsuccess = function(event) {
            console.log('IndexedDB opened successfully.');
        };

        // 处理数据库打开失败的情况
        dbPromise.onerror = function(event) {
            console.error('IndexedDB error:', event.target.errorCode);
        };
    }

    // 首次运行时初始化 IndexedDB
    initializeIndexedDB();

    const batchSize = 1000; // 每次存入的批量大小

    // 提取好友 ID 的函数
    function extractFriendIDsFromHTML() {
        const userElements = document.querySelectorAll('.user'); // 获取所有包含好友信息的元素
        const friendIDs = [];
        userElements.forEach(element => {
            const link = element.querySelector('a[href^="/user/"]'); // 找到包含用户 ID 的链接
            if (link) {
                const userID = link.getAttribute('href').match(/\/user\/([^\/]+)/)[1]; // 从链接中提取用户 ID
                friendIDs.push(userID);
            }
        });
        return friendIDs;
    }

    // 发送请求获取好友的收藏数据
    async function bangumiAPIFetch(userID, limit, offset, subjectType) {
        const base_url = "https://api.bgm.tv/v0/users";
        const collections_endpoint = `${base_url}/${userID}/collections`;

        const headers = {
            'accept': 'application/json',
            'User-Agent': 'Adachi/BangumiMigrate(https://github.com/Adachi-Git)',
        };

        const params = {
            'subject_type': subjectType,
            'limit': limit,
            'offset': offset
        };

        try {
            const url = new URL(collections_endpoint);
            url.search = new URLSearchParams(params).toString();

            const response = await fetch(url, { headers });
            if (!response.ok) {
                throw new Error(`Failed to fetch collections for user ${userID}. Status code: ${response.status}`);
            }
            const data = await response.json();

            // 保存收藏数据到 IndexedDB
            data.data.forEach(item => {
                saveData(item.subject_id, item.subject.name, userID, item.rate);
            });

            return data.data || [];
        } catch (error) {
            throw new Error(`Failed to fetch collections for user ${userID}: ${error.message}`);
        }
    }

    let totalSaved = 0; // 已保存的收藏总数
    let totalFetched = 0; // 已获取的收藏总数

    // 将数据存入 IndexedDB
    async function saveData(subjectId, subjectName, friendId, rate) {
        const dbPromise = indexedDB.open('friendRatingsDB', 1);

        dbPromise.onsuccess = function(event) {
            const db = event.target.result;
            const transaction = db.transaction(['friendRatingsStore'], 'readwrite');
            const store = transaction.objectStore('friendRatingsStore');

            // 从数据库中获取对应 ID 的记录
            const request = store.get(subjectId);

            request.onsuccess = function(event) {
                const data = event.target.result || {}; // 如果数据库中不存在对应 ID 的记录，则创建一个空对象

                // 更新或添加评分数据
                data[friendId] = rate;

                // 将数据存回数据库
                const putRequest = store.put({ subject_id: subjectId, subject_name: subjectName, ...data });

                // 在评分数据存入数据库后再进行排序
                putRequest.onsuccess = function(event) {
                    totalSaved++;
                    if (totalSaved % batchSize === 0) {
                        displaySortedEntries();
                    }
                };
            };
        };

        dbPromise.onerror = function(event) {
            console.error('IndexedDB error:', event.target.errorCode);
        };
    }

    // 获取所有好友的收藏数据
    async function fetchFriendCollections(subjectType) {
        // 获取好友 ID
        const friendIDs = extractFriendIDsFromHTML();
        const limit = 50; // 每页条目数量
        let completedCount = 0; // 已成功获取数据的好友数量

        // 遍历每个好友 ID
        for (const friendID of friendIDs) {
            let offset = 0;
            try {
                while (true) {
                    // 发送请求获取好友的收藏数据
                    const collections = await bangumiAPIFetch(friendID, limit, offset, subjectType);
                    totalFetched += collections.length;

                    // 如果获取到的数据为空，则说明已经没有更多数据了
                    if (collections.length === 0) {
                        break;
                    }

                    // 更新 offset 的值，准备获取下一页数据
                    offset += limit;

                    // 在控制台输出成功信息
                    console.log(`Successfully fetched collections for friend ${friendID}`);
                }
            } catch (error) {
                // 在控制台输出错误信息
                console.error(`Failed to fetch collections for friend ${friendID}:`, error);
            } finally {
                // 每次成功获取数据后，增加 completedCount 的值
                completedCount++;

                // 如果已成功获取数据的好友数量等于好友总数，则触发 'fetchComplete' 事件
                if (completedCount === friendIDs.length) {
                    window.dispatchEvent(new Event('fetchComplete'));
                }
            }
        }
    }

    // 当所有数据都成功获取后，弹出提示窗口
    window.addEventListener('fetchComplete', () => {
        alert('所有好友的收藏数据已成功获取！');
    });

    // 获取用户输入的主题类型
    function getUserSubjectType() {
        let subjectType;
        do {
            subjectType = prompt('请输入要获取的主题类型：\n1 - 书籍\n2 - 动画\n3 - 音乐\n4 - 游戏\n6 - 三次元');
            subjectType = parseInt(subjectType);
        } while (![1, 2, 3, 4, 6].includes(subjectType));
        return subjectType;
    }

    // 创建按钮元素
    const button = document.createElement('a');

    // 设置按钮的类名、链接和标题
    button.className = 'chiiBtn';
    button.href = 'javascript:void(0)';
    button.textContent = '获取友评排行榜';

    // 按钮点击事件
    button.onclick = function() {
        const subjectType = getUserSubjectType();
        fetchFriendCollections(subjectType);
    };

    // 找到要添加按钮的元素
    const nameElement = document.querySelector('.name');

    // 将按钮添加到该元素的右侧
    nameElement.parentNode.insertBefore(button, nameElement.nextSibling);

    // 创建用于显示排序后条目的容器
    const container = document.createElement('div');
    container.id = 'sortedEntries';
    container.style.cssText = 'position: fixed; top: 50%; right: 10px; transform: translateY(-50%); width: 300px; height: 300px; background-color: #f0f0f0; padding: 10px; overflow-y: auto;';
    document.body.appendChild(container);

    // 创建用于显示筛选人数输入框的容器
    const filterContainer = document.createElement('div');
    filterContainer.style.cssText = 'position: fixed; top: 10%; right: 10px;';

    // 创建筛选人数输入框
    const filterInput = document.createElement('input');
    filterInput.type = 'number';
    filterInput.placeholder = '输入评分人数';
    filterInput.addEventListener('input', filterEntries);

    // 将输入框添加到筛选容器中
    filterContainer.appendChild(filterInput);

    // 将筛选容器添加到页面中
    document.body.appendChild(filterContainer);

    // 筛选函数
    function filterEntries() {
        const filterValue = parseInt(filterInput.value); // 获取输入的评分人数
        const sortedEntries = document.querySelectorAll('#sortedEntries > div'); // 获取所有条目
        let index = 0; // 初始化新的序号

        // 遍历所有条目，根据评分人数筛选显示
        sortedEntries.forEach(entry => {
            const numRates = parseInt(entry.textContent.match(/评分人数: (\d+)/)[1]); // 从文本中提取评分人数
            if (isNaN(filterValue) || numRates >= filterValue) { // 如果评分人数大于等于筛选值，则显示条目
                entry.style.display = 'block';
                // 更新条目的序号
                entry.firstChild.textContent = `${++index} - `;
            } else { // 否则隐藏条目
                entry.style.display = 'none';
            }
        });
    }

    // 页面加载时检查IndexedDB中的数据并排序显示
    displaySortedEntries();

    // 检查IndexedDB中的数据并排序显示
    function displaySortedEntries() {
        const dbPromise = indexedDB.open('friendRatingsDB', 1);

        dbPromise.onsuccess = function(event) {
            const db = event.target.result;
            const transaction = db.transaction(['friendRatingsStore'], 'readonly');
            const store = transaction.objectStore('friendRatingsStore');

            const request = store.getAll();

            request.onsuccess = function(event) {
                const data = event.target.result;
                const sortedEntries = sortEntries(data);
                renderSortedEntries(sortedEntries);
            };

            request.onerror = function(event) {
                console.error('Error getting all friend collections:', event.target.error);
            };
        };

        dbPromise.onerror = function(event) {
            console.error('IndexedDB error:', event.target.errorCode);
        };
    }

    // 对数据进行排序
    function sortEntries(data) {
        const sortedEntries = [];
        for (const entry of data) {
            const subjectId = entry.subject_id;
            const subjectName = entry.subject_name;
            let totalRate = 0;
            let numRates = 0;
            for (const key in entry) {
                if (key !== 'subject_id' && key !== 'subject_name' && !isNaN(entry[key])) {
                    if (entry[key] !== 0) { // 如果评分不为0，则计入总评分和评分人数
                        totalRate += entry[key]; // 将每个用户的评分值累加到总评分中
                        numRates++; // 统计给出评分的用户数量
                    }
                }
            }
            const averageRate = numRates > 0 ? totalRate / numRates : 0;
            sortedEntries.push({ subjectId, subjectName, averageRate, numRates });
        }
        sortedEntries.sort((a, b) => b.averageRate - a.averageRate);
        return sortedEntries;
    }

    function renderSortedEntries(sortedEntries) {
        const container = document.getElementById('sortedEntries');
        container.innerHTML = '';
        const currentDomain = window.location.hostname; // 获取当前页面的域名

        sortedEntries.forEach((entry, index) => {
            const div = document.createElement('div');

            // 设置文字颜色
            div.style.color = '#F09199';
            const subjectLink = document.createElement('a');
            subjectLink.href = `https://${currentDomain}/subject/${entry.subjectId}`; // 使用当前域名构造链接
            subjectLink.textContent = entry.subjectName;
            subjectLink.target = '_blank'; // 在新标签页打开链接
            // 设置超链接字体颜色
            subjectLink.style.color = '#1e90ff'; // 道奇蓝
            div.appendChild(document.createTextNode(`${index + 1} - `));
            div.appendChild(subjectLink);
            div.appendChild(document.createTextNode(` - 平均评分: ${entry.averageRate.toFixed(2)} - 评分人数: ${entry.numRates}`));

            // 设置字体大小为14px
            div.style.fontSize = '14px';

            container.appendChild(div);
        });
    }
})();
