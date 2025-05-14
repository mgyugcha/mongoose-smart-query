import mongooseSmartQuery from '../src/mongoose-smart-query'
import { Types, connect, Schema, model, connection, Document } from 'mongoose'

const dbname = 'mongoose-smart-query-test'

export default {
  async start() {
    const uri = `mongodb://127.0.0.1:27018,127.0.0.1:27019/${dbname}?replicaSet=rs0`
    await connect(uri)
    interface Person extends Document {
      name: string
      random: number
      birthday: Date
      colours: string[]
      password: string
      useLinux?: boolean
      bestFriend?: Types.ObjectId
      amigo: {
        bestFriend?: Types.ObjectId
      }
      searchString: string
    }
    const PersonSchema = new Schema<Person>({
      name: String,
      random: Number,
      birthday: Date,
      colours: [String],
      password: String,
      useLinux: Boolean,
      bestFriend: { type: Types.ObjectId, ref: 'persons' },
      amigo: {
        bestFriend: { type: Types.ObjectId, ref: 'persons' },
      },
      searchString: String,
    })
    PersonSchema.plugin(mongooseSmartQuery, {
      defaultFields: 'name',
      protectedFields: 'password',
      fieldsForDefaultQuery: 'name bestFriend.name',
      fieldsForDefaultSearch: ['searchString'],
    })
    PersonSchema.pre('validate', function (next) {
      if (this.isModified('name'))
        this.searchString = this.name.toLowerCase().replace(/[^a-z0-9]/g, '')
      next()
    })
    const Persons = model<Person>('persons', PersonSchema)
    await Persons.insertMany([
      {
        _id: '5cef28d32e950227cb5bfaa6',
        name: 'Michael Yugcha',
        random: 25,
        birthday: new Date('1993-09-27T05:00:00.000Z'),
        colours: ['blue', 'red', 'black'],
        password: '12345',
        useLinux: true,
        amigo: {
          bestFriend: '5cef28d32e950227cb5bfaa7',
        },
      },
      {
        _id: '5cef28d32e950227cb5bfaa7',
        name: 'Carlos Narvaez',
        random: 18,
        birthday: new Date('1995-01-12T05:00:00.000Z'),
        colours: ['yellow', 'red'],
        password: '12345',
        useLinux: false,
        bestFriend: '5cef28d32e950227cb5bfaa6',
      },
      {
        _id: '5cef28d32e950227cb5bfaa8',
        name: 'Luis Ñandú',
        random: 1,
        birthday: new Date('1984-04-07T05:00:00.000Z'),
        colours: ['pink', 'white'],
        password: '12345',
      },
      {
        _id: '5d0ceed6d0daeb2019a142f8',
        name: 'Marta Narvaez',
        random: 9,
        birthday: new Date('1993-04-01T05:00:00.000Z'),
        colours: ['pink', 'black'],
        password: '12345',
      },
    ])
  },
  async close() {
    await connection.dropDatabase()
    connection.close()
  },
}

export const getPersonModel = () => model('persons')
