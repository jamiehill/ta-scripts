#!/usr/bin/env node
'use strict'

const sh = require('shelljs')
const yargs = require('yargs')

// exit on any error, like bash 'set -e'
sh.config.fatal = true

const argv = yargs
  .usage('\nUsage: $0 --repo <name> --branch <name> [options]')
  .strict()
  .example('$0 -r unity -b bug/foo -d dist', 'stage dist contents as unity bug/foo')
  .example('$0 -r unity -b bug/foo -t', 'tear down staging for unity bug/foo')
  .example('$0 -r unity -b bug/foo -g', 'get the url for unity bug/foo')
  .option('r', {
    alias: 'repo',
    describe: 'name of the github repo',
    demand: true,
    requiresArg: true,
    type: 'string',
  })
  .option('b', {
    alias: 'branch',
    describe: 'name of the github branch',
    demand: true,
    requiresArg: true,
    type: 'string',
  })
  .option('d', {
    alias: 'directory',
    describe: 'local directory to sync to s3',
    demand: false,
    requiresArg: true,
    type: 'string',
  })
  .option('t', {
    alias: 'tear-down',
    describe: 'tear down a staged repo/branch',
    demand: false,
    requiresArg: false,
    type: 'boolean',
  })
  .option('g', {
    alias: 'get-url',
    describe: 'get the url for a staged repo/branch',
    demand: false,
    requiresArg: false,
    type: 'boolean',
  })
  .check((argv, options) => {
    // directory XOR tear-down
    const requireOne = [argv.directory, argv.tearDown, argv.getUrl]
    if (requireOne.filter(arg => !!arg).length !== 1) {
      throw new Error('Specify either --directory, --tear-down, or --get-url options.')
    }

    return true
  })
  .help('h')
  .alias('h', 'help')
  .argv

// ------------------------------------
// Run
// ------------------------------------

// Ensure aws cli
if (!sh.which('aws')) sh.exec('sudo pip install awscli', { silent: true })

const REGION = 'us-east-1'

// -r myRepo -b feature/foo-bar => 'my-repo-feature-foo-bar'
const bucket = `staging-${argv.repo}-${argv.branch}`
  .replace(/[\W|_]/gi, '-')                 // non-word characters and '_' to '-'
  .replace(/[A-Z]/g, match => `-${match}`)  // prefix capitals with '-'
  .toLowerCase()                            // all lowercase

// if bucket exists, echo it's website url, else fail
function getStagingUrl(bucket, region) {
  // disable fatal so we can log any error before exiting
  const oldFatal = sh.config.fatal
  sh.config.fatal = false

  // silently verify bucket, or fail
  const website = sh.exec(`aws s3api get-bucket-website --bucket ${bucket}`, { silent: true })
  if (website.code !== 0) {
    console.error(website.stderr || website.stdout || sh.error())
    process.exit(website.code)
  }

  // restore fatal config and echo url
  sh.config.fatal = oldFatal
  sh.echo(`${bucket}.s3-website-${region}.amazonaws.com`)
}

function stage(dir, bucket, region) {
  // create bucket
  // set static hosting
  // sync dir
  sh.exec(`aws s3api create-bucket --bucket ${bucket} --acl public-read --region ${region}`)
  sh.exec(`aws s3 website s3://${bucket}/ --index-document index.html --error-document index.html`)
  sh.exec(`aws s3 sync ${dir} s3://${bucket}/ --delete --acl public-read`)

  getStagingUrl(bucket, region)
}

function tearDown(bucket) {
  // empty bucket and delete it
  sh.exec(`aws s3 rm s3://${bucket}/ --recursive`)
  sh.exec(`aws s3api delete-bucket --bucket ${bucket}`)
}

if (argv.directory) stage(argv.directory, bucket, REGION)
if (argv.tearDown) tearDown(bucket)
if (argv.getUrl) getStagingUrl(bucket, REGION)
