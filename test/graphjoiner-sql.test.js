import { extend, fromPairs, mapKeys, zip } from "lodash";
import { graphql, GraphQLSchema, GraphQLInt, GraphQLString } from "graphql";

import { JoinType, RootJoinType, single, many, execute } from "../lib";
import { testCases } from "./executionTestCases";

import Knex from "knex";

let knex;

exports.beforeEach = () => {
    knex = Knex({
        dialect: "sqlite3",
        connection: {
            filename: ":memory:"
        },
        useNullAsDefault: true
    });

    return knex.schema
        .createTable("author", function(table) {
            table.increments("id");
            table.string("name");
        })
        .createTable("book", function(table) {
            table.increments("id");
            table.string("title");
            table.integer("author_id").unsigned().references("author.id")
        })
        .then(() => knex.insert([
            {id: 1, name: "PG Wodehouse"},
            {id: 2, name: "Joseph Heller"}
        ]).into("author"))
        .then(() => knex.insert([
            {id: 1, title: "Leave It to Psmith", author_id: 1},
            {id: 2, title: "Right Ho, Jeeves", author_id: 1},
            {id: 3, title: "Catch-22", author_id: 2}
        ]).into("book"));
};

function fetchImmediatesFromQuery(request, {query}) {
    const fields = this.fields();
    const requestedColumns = request.requestedFields.map(field => fields[field].columnName);
    const columnsToFields = fromPairs(zip(requestedColumns, request.requestedFields));
    return query.select(request.requestedColumns).then(records =>
        records.map(record =>
            mapKeys(record, (value, name) => columnsToFields[name])
        )
    );
}

const Author = new JoinType({
    name: "Author",

    fields() {
        return {
            id: JoinType.field({columnName: "id", type: GraphQLInt}),
            name: JoinType.field({columnName: "name", type: GraphQLString}),
            books: many(
                Book,
                (request, {query: authorQuery}) => ({
                    query: knex("book").join(
                        authorQuery.select("author.id").distinct().as("author"),
                        "book.author_id",
                        "author.id"
                    )
                }),
                {"id": "authorId"}
            )
        };
    },

    fetchImmediates: fetchImmediatesFromQuery
});

const Book = new JoinType({
    name: "Book",

    fields() {
        return {
            id: JoinType.field({columnName: "id", type: GraphQLInt}),
            title: JoinType.field({columnName: "title", type: GraphQLString}),
            authorId: JoinType.field({columnName: "author_id", type: GraphQLInt}),
            author: single(
                Author,
                (request, {query: bookQuery}) => ({
                    query: knex("author").join(
                        bookQuery.select("book.author_id").distinct().as("book"),
                        "author.id",
                        "book.author_id"
                    )
                }),
                {"authorId": "id"}
            )
        };
    },

    fetchImmediates: fetchImmediatesFromQuery
});


const Root = new RootJoinType({
    name: "Query",

    fields() {
        return {
            "books": many(Book, () => ({query: knex("book")})),
            "author": single(Author, request => {
                let authors = knex("author");

                const authorId = parseInt(request.args["id"], 10);
                if (authorId != null) {
                    authors = authors.where("id", "=", authorId);
                }

                return {query: authors};
            }, {})
        };
    }
});

extend(exports, testCases(query => execute(Root, query)));
