import './assets/style/theme.styl';
import './assets/style/main.css';
import './assets/style/components.styl';
import 'virtual:svg-icons-register';
import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import router from './router';

const app = createApp(App);
const pinia = createPinia();

app.use(pinia);
app.use(router);
app.mount('#app');
