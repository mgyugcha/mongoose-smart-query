# mongoose-smart-query

`mongoose-smart-query` toma como entrada un objeto (ejemplo: `req.query`) e
interpreta las condiciones para poder realizar una consulta 'inteligente', de
acuerdo al esquema definido en mongoose. Las consultas se las realiza totalmente
con [aggregate](https://docs.mongodb.com/manual/aggregation).
