import mongooseSmartQuery from '../src/mongoose-smart-query'
import { Types, connect, Schema, model, connection, Document } from 'mongoose'

const dbname = 'mongoose-smart-query-test'

export default {
  async start () {
    const uri = `mongodb://localhost:27017/${dbname}`
    await connect(uri, { useNewUrlParser: true, useUnifiedTopology: true })
    interface Person extends Document {
      name: string;
      random: number;
      birthday: Date;
      colours: string[],
      password: string;
      useLinux?: boolean;
      bestFriend?: Types.ObjectId,
    }
    const PersonSchema = new Schema<Person>({
      name: String,
      random: Number,
      birthday: Date,
      colours: [String],
      password: String,
      useLinux: Boolean,
      bestFriend: { type: Types.ObjectId, ref: 'persons' },
    })
    PersonSchema.plugin(mongooseSmartQuery, {
      defaultFields: 'name',
      protectedFields: 'password',
      fieldsForDefaultQuery: 'name bestFriend.name',
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
      }
    ])
  },
  async close () {
    await connection.dropDatabase()
    connection.close()
  }
}

export const getPersonModel = () => model('persons')