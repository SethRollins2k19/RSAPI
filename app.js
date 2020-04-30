var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');
var cors = require('cors');
var indexRouter = require('./routes/index');
var usersRouter = require('./routes/users');

var app = express();
const AmoCRM = require( 'amocrm-js' );

const crm = new AmoCRM({
    // логин пользователя в портале, где адрес портала domain.amocrm.ru
    domain: 'tsuperstrun', // может быть указан полный домен вида domain.amocrm.ru, domain.amocrm.com
    auth: {
        login: 'tsuperstrun@mail.ru',
        hash: 'f2b6674fb7b7cdc37424ac597448f003ad1b5602', // API-ключ доступа
    }
});

const getContacts = (request, response) => {
    const {query} = request.body;
    // console.log(query);
    crm.request.get('/api/v2/account?with=users,custom_fields,pipelines,groups,note_types,task_types').then(res =>{
        let pipelines = res._embedded.pipelines;

        //first promise to get all pipelines
        const parsePipelines = new Promise(resolve => {
            let PipelinesWithStatus = {};
            for (pipe in pipelines){
                PipelinesWithStatus[pipe] = {
                    name: pipelines[pipe].name,
                    statuses: pipelines[pipe].statuses
                }
            }
            resolve(PipelinesWithStatus);
        });

        parsePipelines.then(pipelines=>{
            crm.request.get('/api/v2/contacts',{query}).then(res =>{
                if(!res._embedded){
                    response.send([]);
                    return;
                }
                let customers = res._embedded.items;
                //second promise for parse contacts to contacts without useless params
                const parseCustomers = new Promise(resolve => {
                    let parsedCustomers = [];
                    customers.forEach(item=>{
                        parsedCustomers.push({
                            name: item.name,
                            custom_fields: item.custom_fields,
                            leads:item.leads,
                            tags: item.tags
                        })
                    });
                    resolve(parsedCustomers)
                });
                parseCustomers.then((parsedCustomers =>{
                    //third promise for connect contact with leads
                    const parseLeads = (customer) => new Promise(resolve => {
                        if(customer.leads.id){
                            crm.request.get(customer.leads._links.self.href).then(res =>{
                                resolve(res._embedded.items);
                            })
                        } else {
                            resolve([])
                        }
                    });
                    let normalCustomer = parsedCustomers.reduce((customers,item) =>{
                        customers.push(parseLeads(item));
                        return customers;
                    },[]);
                    //response connected costumers with leads and pipelines
                    Promise.all(normalCustomer).then(leads => {
                        let temp = [];
                        parsedCustomers.forEach((item,index) => {
                            temp.push({
                                name: item.name,
                                phone: item.custom_fields[0].values[0].value,
                                email: item.custom_fields[1].values[0].value,
                                tags: item.tags,
                                leads: [...leads[index].map(item=>{
                                    return {
                                        name: item.name,
                                        pipelines: pipelines[item.pipeline_id],
                                        sale: item.sale,
                                        status: item.status_id
                                    }
                                })]
                            })
                        });
                        response.send([...temp])
                    });
                }));
            })
        })
    });
};

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cors());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/', indexRouter);
app.use('/users', usersRouter);
app.post('/getContact', getContacts);

module.exports = app;
