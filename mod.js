import "https://deno.land/x/dotenv/load.ts";

import { DOMParser } from "https://deno.land/x/deno_dom/deno-dom-wasm.ts";

import { createDatastore } from 'https://git.kaki87.net/KaKi87/xedb/raw/commit/913a894ef5e4e96bc885e57f8e9bb4d5fc97bf6f/mod.js';
import deno from 'https://git.kaki87.net/KaKi87/xedb/raw/commit/913a894ef5e4e96bc885e57f8e9bb4d5fc97bf6f/lib/deno.js';

import PQueue from "https://deno.land/x/p_queue@1.0.1/mod.ts";

const datastore = createDatastore({
    runtime: deno,
    path: './items.db'
});
datastore.load();

const queue = new PQueue({
    concurrency: 1,
    intervalCap: 1,
    interval: 1000
});

/**
 * Fetches the items from Sleeping Money and returns an array of cleaned items
 * @returns {Promise<ItemData[]>}
 */
const fetchItems = async () => {

    const url = 'https://annonces.sleepingmoney.com';

    console.log(`[${new Date().toLocaleString()}] Fetching items...`);

    const response = await fetch(url);
    const content = await response.text();
    const document = new DOMParser().parseFromString(content, "text/html");
    const items = document.querySelectorAll('.home-fluid-thumbnail-grid-item');

    const itemsData = [];

    for (const item of items) {
        const link = url + item.querySelector('.fluid-thumbnail-grid-image-item-link').getAttribute('href');
        const [_idMatch, rawId] = link.match(/sleepingmoney\.com\/fr\/listings\/(\d+)/);
        const id = parseInt(rawId);
        const rawTitle = item.querySelector('.fluid-thumbnail-grid-image-title').textContent.trim();
        const rawSoldPrice = item.querySelector('.fluid-thumbnail-grid-image-price').textContent.trim();
        const [_titleMatch, title, rawOriginalPrice] = rawTitle.match(/(.*) \(((?:[0-9])+(?:,(?:[0-9])+)?)€\)$/);
        const imageUrl = item.querySelector('.fluid-thumbnail-grid-image-image').getAttribute('src');
        const originalPrice = parseFloat(rawOriginalPrice.replace(',', '.'));
        const soldPrice = parseFloat(rawSoldPrice.replace(',', '.'));

        itemsData.push({
            id,
            link,
            title,
            originalPrice,
            soldPrice,
            imageUrl
        });
    }

    console.log(`[${new Date().toLocaleString()}] Fetched ${itemsData.length} items`);

    return itemsData;
}

/**
 * Compares the items from the database with the items from the website and returns the notification objects
 * @param {Promise<null>} items 
 */
const compareCache = async (items) => {

    console.log(`[${new Date().toLocaleString()}] Comparing cache...`);

    const cachedItems = await datastore.find({
        id: {
            $in: items.map(item => item.id)
        }
    });

    const newItems = items.filter(item => !cachedItems.find(cachedItem => cachedItem.id === item.id));

    newItems.forEach(async (item) => {
        const fees = Math.max(item.soldPrice * 0.03, 2);
        const won = Math.floor(item.originalPrice - item.soldPrice - fees);
        await queue.add(() => sendNotification({
            title: `(Δ${won}€) ${item.title}`,
            message: `Coût: ${item.soldPrice}€\nUtilisable: ${item.originalPrice}€\n`,
            url: item.link,
            priority: won > 30 ? 1 : won > 10 ? 0 : -1,
        }).then(() => {
            datastore.insertOne(item);
        }));
    });

    console.log(`[${new Date().toLocaleString()}] ${newItems.length} new items`);

}

/**
 * Sends the notifications to the delivery group
 * @param {Promise<null>} notification 
 */
const sendNotification = async (notification) => {

    const appToken = Deno.env.get('APP_TOKEN');
    const groupToken = Deno.env.get('GROUP_TOKEN');

    const pushUrl = 'https://api.pushover.net/1/messages.json';

    const response = await fetch(pushUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            token: appToken,
            user: groupToken,
            ...notification
        })
    });

    const content = await response.json();
    console.log(content)

    if (content.status !== 1) {
        throw new Error('Pushover API error');
    }
}

const synchronize = () => fetchItems().then((items) => compareCache(items));

synchronize();
setInterval(() => synchronize(), 60_000);
